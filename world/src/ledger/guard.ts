// The write-guard. Every append passes through here BEFORE it touches the ledger.
// Enforcement is mechanical: out-of-scope city tags, wrong writers, unauthorized lifecycle
// actions and invalid transitions are REJECTED, not filtered.
import { specFor, type EventKind, type EventSpec } from './catalog.ts';
import { conflict, forbid, invalid, notFound } from './errors.ts';
import { validate, type Payload } from './validate.ts';
import { consumeKey, isJailed, type Agent, type LedgerEvent, type WorldState } from '../domain/state.ts';
import {
  DEPT_LEAD_BADGE,
  DEPT_LEAD_MIN_AGENTS,
  INTERN_BADGE,
  MAX_CITIES_PER_FAMILY,
  MAX_STRIKES,
  SECURITY_CITY_ID,
  WORLD_TAG,
  type Role,
} from '../domain/model.ts';

export interface Profile {
  id: string;
  role: Role;
  /** City tags this profile may write. '*' = any (owner intents, DM). Mayor = exactly its own city. */
  writeScope: readonly string[];
  label?: string;
}

export interface AppendInput {
  type: string;
  city: string;
  subject?: string | null;
  payload?: unknown;
  authorizedBy?: number | null;
}

export interface Draft {
  kind: EventKind;
  type: string;
  city: string;
  subject: string | null;
  payload: Payload;
  authorizedBy: number | null;
  allocates?: EventSpec['allocates'];
}

export function inWriteScope(profile: Profile, city: string): boolean {
  return profile.writeScope.includes('*') || profile.writeScope.includes(city);
}

export function checkWrite(state: WorldState, profile: Profile, input: AppendInput, now: Date): Draft {
  if (profile.role === 'architect') forbid('Bob the Architect is read-only; no writes');

  const spec = specFor(String(input.type)) ?? invalid(`unknown event type: ${input.type}`);
  if (!spec.writers.includes(profile.role)) {
    forbid(`${profile.role} may not write ${input.type}${spec.kind === 'fact' && profile.role === 'owner' ? ' (the dashboard writes intents; the DM routes them)' : ''}`);
  }

  const city = typeof input.city === 'string' ? input.city.trim() : invalid('city tag is required');
  if (!inWriteScope(profile, city)) forbid(`write rejected: city tag "${city}" is outside ${profile.id}'s write scope`);

  if (spec.scope === 'world' && city !== WORLD_TAG) invalid(`${input.type} is a world event; city tag must be ${WORLD_TAG}`);
  if (spec.scope === 'city' && !state.cities.has(city)) notFound(`unknown city: ${city}`);

  const payload = validate(spec.schema, input.payload ?? {});

  if (spec.allocates && input.subject) invalid(`${input.type} subject is assigned by the ledger; do not supply one`);

  let agent: Agent | undefined;
  if (spec.subject === 'agent') {
    agent = state.agents.get(String(input.subject)) ?? notFound(`unknown agent: ${input.subject}`);
    if (agent.cityId !== city) forbid(`agent ${agent.id} belongs to ${agent.cityId}, not ${city}`);
    if (agent.deleted) conflict(`agent ${agent.id} is deleted; its ID is retired`);
  } else if (!spec.allocates && input.subject) {
    invalid(`${input.type} takes no subject`);
  }

  const draft: Draft = {
    kind: spec.kind,
    type: input.type,
    city,
    subject: agent?.id ?? null,
    payload,
    authorizedBy: null,
    allocates: spec.allocates,
  };

  let intent: LedgerEvent | undefined;
  if (spec.authorizedBy) {
    const seq = input.authorizedBy;
    if (typeof seq !== 'number' || !Number.isInteger(seq)) {
      forbid(`${input.type} must cite an owner intent routed by the DM (authorizedBy); never self-initiated`);
    }
    intent = state.intents.get(seq as number) ?? notFound(`intent #${seq} not found`);
    if (!spec.authorizedBy.includes(intent.type)) forbid(`intent #${seq} (${intent.type}) cannot authorize ${input.type}`);
    if (!state.routed.has(intent.seq)) forbid(`intent #${seq} has not been routed by the DM`);
    // A city's creation intent (tagged WORLD) also authorizes that new city's initial districts.
    const initialDistrict = input.type === 'district.created' && intent.type === 'intent.create_city';
    if (!initialDistrict && intent.city !== city) forbid(`intent #${seq} is for ${intent.city}, not ${city}`);
    draft.authorizedBy = intent.seq;
    if (state.consumed.has(consumeKey(draft))) conflict(`intent #${seq} has already been fulfilled by ${input.type}`);
  } else if (input.authorizedBy !== undefined && input.authorizedBy !== null) {
    invalid(`${input.type} takes no authorizedBy`);
  }

  checkRules(state, draft, agent, intent, now);
  return draft;
}

/** A jailed agent does no work: it cannot climb, move, or be measured while inside. */
const BLOCKED_IN_JAIL = new Set([
  'security.task_strike',
  'task.delegated',
  'exam.graded',
  'agent.interned',
  'agent.graduated',
  'agent.promoted',
  'agent.lead_assigned',
  'agent.moved',
  'agent.school_returned',
  'agent.third_strike',
  'intent.promote_agent',
  'intent.move_agent',
  'intent.retire_to_professor',
  'agent.retired_to_professor',
]);

/** Department-ladder actions that never apply to a professor (professors belong to the college). */
const AGENT_ONLY = new Set([
  'agent.placed',
  'agent.interned',
  'agent.graduated',
  'agent.promoted',
  'agent.lead_assigned',
  'agent.moved',
  'agent.deployed',
  'agent.retired_to_professor',
  'exam.graded',
  'task.delegated',
  'task.returned',
  'intent.place_agent',
  'intent.promote_agent',
  'intent.move_agent',
  'intent.deploy_agent',
  'intent.retire_to_professor',
]);

const GRADUATED = ['probationer', 'active', 'senior'];

function checkRules(state: WorldState, d: Draft, agent: Agent | undefined, intent: LedgerEvent | undefined, now: Date) {
  const p = d.payload as Record<string, any>;
  const ip = (intent?.payload ?? {}) as Record<string, any>;
  const match = (keys: string[]) => {
    for (const k of keys) {
      if (JSON.stringify(p[k] ?? null) !== JSON.stringify(ip[k] ?? null)) {
        forbid(`${d.type}.${k} does not match authorizing intent #${intent!.seq}`);
      }
    }
  };
  const departmentIn = (id: unknown, city: string) => {
    const dept = state.departments.get(String(id)) ?? notFound(`unknown department: ${id}`);
    if (dept.cityId !== city) forbid(`department ${dept.id} is not in ${city}`);
    return dept;
  };
  const agentIn = (id: unknown, city: string) => {
    const a = state.agents.get(String(id)) ?? notFound(`unknown agent: ${id}`);
    if (a.cityId !== city) forbid(`agent ${a.id} is not in ${city}`);
    if (a.deleted) conflict(`agent ${a.id} is deleted; its ID is retired`);
    return a;
  };
  const checkSettings = () => {
    const tasks = p.basicTasks;
    if (tasks === undefined) return;
    if (!Array.isArray(tasks) || tasks.length > 50) invalid('basicTasks must be a list (max 50)');
    for (const t of tasks) {
      if (typeof t !== 'string' || !t.trim() || t.length > 200) invalid('each basic task must be text (max 200 characters)');
    }
    if (new Set(tasks).size !== tasks.length) invalid('basicTasks has duplicates');
  };
  const underCap = (deptId: string, kind: 'graduated' | 'shadows') => {
    const dept = state.departments.get(deptId)!;
    const cap = kind === 'graduated' ? dept.maxGraduated : dept.maxShadows;
    const count = (kind === 'graduated' ? state.graduatedIn(deptId) : state.shadowsIn(deptId)).length;
    if (cap !== null && count >= cap) conflict(`department ${deptId} is at its ${kind} cap (${cap})`);
  };
  const professorIn = (id: unknown, city: string) => {
    const prof = state.agents.get(String(id));
    if (!prof || prof.role !== 'professor' || prof.deleted) return notFound(`unknown professor: ${id}`);
    if (prof.cityId !== city) forbid(`professor ${prof.id} is not in ${city}`);
    if (isJailed(prof, now)) conflict(`professor ${prof.id} is in jail`);
    return prof;
  };
  // KPI strikes apply to graduated department agents. Professors get teaching strikes instead (A13).
  const canMissKpi = (a: Agent) => a.role === 'agent' && GRADUATED.includes(a.state);
  const familyHasRoom = () => {
    const max = MAX_CITIES_PER_FAMILY[p.family as keyof typeof MAX_CITIES_PER_FAMILY];
    const count = [...state.cities.values()].filter((c) => c.family === p.family).length;
    if (max !== undefined && count >= max) conflict(`the ${p.family} family holds ${max} ${max === 1 ? 'city' : 'cities'}; it already has ${count}`);
  };
  const missed = () => {
    if (!(p.value < p.target)) invalid('a strike requires a KPI miss (value < target)');
  };
  const intentAgent = () => {
    if (ip.agentId !== agent!.id) forbid(`intent #${intent!.seq} is for agent ${ip.agentId}, not ${agent!.id}`);
  };

  const target = agent ?? (typeof p.agentId === 'string' ? state.agents.get(p.agentId) : undefined);
  if (target && isJailed(target, now) && BLOCKED_IN_JAIL.has(d.type)) {
    const j = target.jail!;
    conflict(`agent ${target.id} is in jail (${j.status === 'serving' ? `term ${j.term} until ${j.until}` : 'awaiting deletion'})`);
  }
  if (target && target.role !== 'agent' && AGENT_ONLY.has(d.type)) {
    conflict(`${target.id} is a ${target.role} at the college; ${d.type} applies to department agents only`);
  }
  /** A Security agent deployed to `city` (task strikes, teaching strikes). */
  const deployedObserver = (id: unknown, city: string, subjectId: string) => {
    const obs = state.agents.get(String(id)) ?? notFound(`unknown observer: ${id}`);
    if (obs.cityId !== SECURITY_CITY_ID || obs.deleted || obs.role !== 'agent') forbid(`observer ${obs.id} is not a Security City agent`);
    if (obs.id === subjectId) forbid('an agent cannot strike itself');
    if (obs.deployedTo !== city) forbid(`observer ${obs.id} is not deployed to ${city}`);
    if (isJailed(obs, now)) conflict(`observer ${obs.id} is in jail`);
    return obs;
  };
  const deanIn = (id: unknown, city: string) => {
    const dean = state.deanOf(city);
    if (!dean || dean.id !== String(id)) notFound(`${id} is not the dean of ${city}`);
    return dean!;
  };

  switch (d.type) {
    // ---- intents: early checks so Marc sees mistakes before the DM routes them ----
    case 'intent.create_city': {
      familyHasRoom();
      const list = p.initialDistricts;
      if (list !== undefined) {
        if (!Array.isArray(list) || list.length > 50) invalid('initialDistricts must be a list (max 50)');
        for (const item of list) validate({ name: { t: 'str', max: 120 }, supervisor: { t: 'str', max: 120 } }, item, 'initialDistricts[]');
      }
      break;
    }
    case 'intent.configure_department':
      departmentIn(p.departmentId, d.city);
      checkSettings();
      break;
    case 'intent.create_professor':
      if (p.departmentId !== undefined) departmentIn(p.departmentId, d.city);
      if (state.isNameRetired(p.name)) conflict(`name "${p.name}" belonged to a deleted agent and is retired forever`);
      break;
    case 'intent.create_department': {
      checkSettings();
      const dist = state.districts.get(String(p.districtId)) ?? notFound(`unknown district: ${p.districtId}`);
      if (dist.cityId !== d.city) forbid(`district ${dist.id} is not in ${d.city}`);
      break;
    }
    case 'intent.create_agent':
      if (state.isNameRetired(p.name)) conflict(`name "${p.name}" belonged to a deleted agent and is retired forever`);
      break;
    case 'intent.place_agent':
      if (agentIn(p.agentId, d.city).state !== 'enrolled') conflict(`agent ${p.agentId} is already placed`);
      departmentIn(p.departmentId, d.city);
      break;
    case 'intent.promote_agent':
    case 'intent.delete_agent':
      agentIn(p.agentId, d.city);
      break;
    case 'intent.deploy_agent': {
      if (d.city !== SECURITY_CITY_ID) forbid(`only ${SECURITY_CITY_ID} agents are deployed`);
      const a = agentIn(p.agentId, d.city);
      if (!a.graduated) conflict(`agent ${a.id} must be graduated to deploy`);
      if (!state.cities.has(String(p.toCity))) notFound(`unknown city: ${p.toCity}`);
      break;
    }
    case 'intent.move_agent':
      agentIn(p.agentId, d.city);
      departmentIn(p.toDepartmentId, d.city);
      break;
    case 'intent.retire_to_professor': {
      const a = agentIn(p.agentId, d.city);
      if (a.state !== 'senior') conflict(`only a senior (tier 5) agent can retire into a professor (agent is ${a.state})`);
      if (p.departmentId !== undefined) departmentIn(p.departmentId, d.city);
      break;
    }
    case 'intent.specialize_professor':
      professorIn(p.professorId, d.city);
      departmentIn(p.departmentId, d.city);
      break;

    // ---- DM ----
    case 'dm.routed': {
      const target = state.intents.get(p.intentSeq) ?? notFound(`intent #${p.intentSeq} not found`);
      if (target.city !== d.city) forbid(`dm.routed city tag must match intent #${target.seq} (${target.city})`);
      if (state.routed.has(target.seq)) conflict(`intent #${target.seq} is already routed`);
      break;
    }
    case 'city.created':
      match(['name', 'family', 'mayorName']);
      familyHasRoom();
      break;
    case 'constitution.amended':
      match(['version', 'docRef', 'summary']);
      break;

    // ---- Mayor: structure ----
    case 'district.created':
      if (intent!.type === 'intent.create_district') {
        match(['name', 'supervisor']);
      } else {
        // A city's optional initial districts, authorized by the city's own creation intent.
        const city = state.cities.get(d.city)!;
        if (city.createdBy !== intent!.seq) forbid(`intent #${intent!.seq} did not create ${d.city}`);
        const listed = (ip.initialDistricts ?? []) as { name: string; supervisor: string }[];
        if (!listed.some((x) => x.name === p.name && x.supervisor === p.supervisor)) {
          forbid(`district "${p.name}" is not among intent #${intent!.seq}'s initial districts`);
        }
      }
      break;
    case 'department.created': {
      match(['districtId', 'name', 'scope', 'botTokenRef', 'maxGraduated', 'maxShadows', 'basicTasks']);
      const dist = state.districts.get(String(p.districtId)) ?? notFound(`unknown district: ${p.districtId}`);
      if (dist.cityId !== d.city) forbid(`district ${dist.id} is not in ${d.city}`);
      break;
    }

    case 'department.configured':
      match(['departmentId', 'maxGraduated', 'maxShadows', 'basicTasks']);
      departmentIn(p.departmentId, d.city);
      break;

    // ---- Mayor: professors, exams, delegation ----
    case 'professor.enrolled':
      match(['name', 'persona', 'domainFocus', 'departmentId']);
      if (p.departmentId !== undefined) departmentIn(p.departmentId, d.city);
      if (state.isNameRetired(p.name)) conflict(`name "${p.name}" belonged to a deleted agent and is retired forever`);
      break;
    case 'agent.retired_to_professor':
      intentAgent();
      match(['departmentId']);
      if (agent!.state !== 'senior') conflict(`only a senior (tier 5) agent can retire into a professor (agent is ${agent!.state})`);
      if (p.departmentId !== undefined) departmentIn(p.departmentId, d.city);
      break;
    case 'professor.specialized':
      match(['professorId', 'departmentId']);
      professorIn(p.professorId, d.city);
      departmentIn(p.departmentId, d.city);
      break;
    case 'department.role_requested':
      departmentIn(p.departmentId, d.city);
      break;
    case 'professor.stepped_in': {
      const prof = professorIn(p.professorId, d.city);
      departmentIn(p.departmentId, d.city);
      if (prof.specialtyDepartmentId !== p.departmentId) forbid(`professor ${prof.id} does not specialise in ${p.departmentId}`);
      if (p.requestSeq !== undefined) {
        const req = state.roleRequests.get(p.requestSeq) ?? notFound(`role request #${p.requestSeq} not found`);
        if (req.departmentId !== p.departmentId) forbid(`role request #${req.seq} is for ${req.departmentId}`);
        if (req.filledBy) conflict(`role request #${req.seq} is already filled`);
      }
      break;
    }
    case 'professor.strike': {
      if (d.city !== SECURITY_CITY_ID) forbid(`only ${SECURITY_CITY_ID} applies teaching strikes`);
      const prof = state.agents.get(String(p.professorId));
      if (!prof || prof.role !== 'professor' || prof.deleted) return notFound(`unknown professor: ${p.professorId}`);
      deployedObserver(p.observedBy, prof.cityId, prof.id);
      if (prof.strikes >= MAX_STRIKES) conflict(`professor ${prof.id} already has ${MAX_STRIKES} teaching strikes and awaits deletion`);
      break;
    }
    case 'intent.create_dean':
    case 'dean.appointed':
      if (d.type === 'dean.appointed') match(['name', 'persona', 'domainFocus']);
      if (state.deanOf(d.city)) conflict(`${d.city}'s college already has a dean`);
      if (state.isNameRetired(p.name)) conflict(`name "${p.name}" belonged to a deleted agent and is retired forever`);
      break;
    case 'dean.reviewed':
      deanIn(p.deanId, d.city);
      break;
    case 'intent.replace_dean':
    case 'dean.replaced':
      if (d.type === 'dean.replaced') match(['professorId']);
      // Only a professor of this college in good standing (not jailed; professorIn checks) can become dean.
      professorIn(p.professorId, d.city);
      break;
    case 'dean.reported': {
      const dean = deanIn(p.deanId, d.city);
      if (isJailed(dean, now)) conflict(`dean ${dean.id} is in jail`);
      const a = agentIn(p.agentId, d.city);
      if (a.id === dean.id) forbid('a dean cannot report itself');
      break;
    }
    case 'security.escalated': {
      if (d.city !== SECURITY_CITY_ID) forbid(`only ${SECURITY_CITY_ID} escalates reports to Marc`);
      const report = state.deanReports.get(p.reportSeq) ?? notFound(`dean report #${p.reportSeq} not found`);
      if (report.escalated) conflict(`dean report #${report.seq} was already escalated`);
      break;
    }
    case 'exam.graded': {
      if (agent!.state !== 'student') conflict(`only a student sits an exam (agent is ${agent!.state})`);
      const prof = professorIn(p.professorId, d.city);
      if (prof.specialtyDepartmentId !== agent!.departmentId) forbid(`professor ${prof.id} does not teach ${agent!.departmentId}`);
      break;
    }
    case 'task.delegated': {
      if (!agent!.badges.includes(INTERN_BADGE)) conflict(`agent ${agent!.id} is not a shadow; only shadows take delegated tasks`);
      const from = state.agents.get(String(p.fromAgentId)) ?? notFound(`unknown agent: ${p.fromAgentId}`);
      if (from.deleted || from.role !== 'agent' || from.cityId !== d.city || from.departmentId !== agent!.departmentId) {
        forbid(`only a graduated agent in ${agent!.departmentId} may delegate to its shadows`);
      }
      if (!['probationer', 'active', 'senior'].includes(from.state)) forbid(`agent ${from.id} is not graduated (${from.state})`);
      if (isJailed(from, now)) conflict(`agent ${from.id} is in jail`);
      const dept = state.departments.get(agent!.departmentId!)!;
      if (!dept.basicTasks.includes(String(p.task))) forbid(`"${p.task}" is not on ${dept.id}'s approved basic-task list`);
      break;
    }
    case 'task.returned': {
      const del = state.delegations.get(p.delegationSeq) ?? notFound(`delegation #${p.delegationSeq} not found`);
      if (del.toAgentId !== agent!.id) forbid(`delegation #${del.seq} was not given to ${agent!.id}`);
      if (del.returned) conflict(`delegation #${del.seq} was already returned`);
      break;
    }

    // ---- Mayor: agent lifecycle ----
    case 'agent.enrolled':
      match(['name', 'persona', 'domainFocus']);
      if (state.isNameRetired(p.name)) conflict(`name "${p.name}" belonged to a deleted agent and is retired forever`);
      break;
    case 'agent.placed':
      if (agent!.state !== 'enrolled') conflict(`agent ${agent!.id} is already placed`);
      intentAgent();
      match(['departmentId']);
      departmentIn(p.departmentId, d.city);
      break;
    case 'agent.interned':
      if (agent!.state !== 'student') conflict(`only a student becomes an intern (agent is ${agent!.state})`);
      if (agent!.badges.includes(INTERN_BADGE)) conflict(`agent ${agent!.id} is already an intern`);
      underCap(agent!.departmentId!, 'shadows');
      break;
    case 'agent.graduated':
      if (agent!.state !== 'student' || !agent!.badges.includes(INTERN_BADGE)) {
        conflict(`only an intern (shadow) graduates (agent is ${agent!.state}${agent!.badges.includes(INTERN_BADGE) ? ', intern' : ''})`);
      }
      if (agent!.lastExam?.result !== 'pass') conflict(`agent ${agent!.id} needs a passed exam from a professor to graduate`);
      underCap(agent!.departmentId!, 'graduated');
      break;
    case 'agent.promoted': {
      intentAgent();
      match(['to']);
      const from = p.to === 'active' ? 'probationer' : 'active';
      if (agent!.state !== from) conflict(`promotion to ${p.to} requires ${from} (agent is ${agent!.state})`);
      break;
    }
    case 'agent.lead_assigned': {
      intentAgent();
      if (ip.to !== DEPT_LEAD_BADGE) forbid(`intent #${intent!.seq} promotes to ${ip.to}, not ${DEPT_LEAD_BADGE}`);
      if (agent!.state !== 'senior') conflict(`${DEPT_LEAD_BADGE} requires senior (agent is ${agent!.state})`);
      const members = state.graduatedIn(agent!.departmentId!);
      if (members.length < DEPT_LEAD_MIN_AGENTS) conflict(`${DEPT_LEAD_BADGE} only when a department has ${DEPT_LEAD_MIN_AGENTS}+ graduated agents`);
      if (members.some((a) => a.badges.includes(DEPT_LEAD_BADGE))) conflict(`department already has a ${DEPT_LEAD_BADGE}`);
      break;
    }
    case 'agent.moved':
      intentAgent();
      match(['toDepartmentId']);
      if (!agent!.departmentId) conflict(`agent ${agent!.id} is not placed yet`);
      if (agent!.departmentId === p.toDepartmentId) conflict(`agent ${agent!.id} is already in ${p.toDepartmentId}`);
      departmentIn(p.toDepartmentId, d.city);
      if (['probationer', 'active', 'senior'].includes(agent!.state)) underCap(p.toDepartmentId, 'graduated');
      if (agent!.badges.includes(INTERN_BADGE)) underCap(p.toDepartmentId, 'shadows');
      break;
    case 'agent.deployed':
      intentAgent();
      match(['toCity']);
      if (!agent!.graduated) conflict(`agent ${agent!.id} must be graduated to deploy`);
      if (!state.cities.has(String(p.toCity))) notFound(`unknown city: ${p.toCity}`);
      break;
    case 'security.task_strike': {
      if (d.city !== SECURITY_CITY_ID) forbid(`only ${SECURITY_CITY_ID} records task strikes`);
      const a = state.agents.get(String(p.agentId)) ?? notFound(`unknown agent: ${p.agentId}`);
      if (a.deleted) conflict(`agent ${a.id} is deleted`);
      // Professors take only teaching strikes (A15); the Mayor judges deans.
      if (a.role !== 'agent') forbid(`${a.id} is a ${a.role}; Security applies task strikes to department agents only`);
      if (a.state === 'enrolled') conflict(`agent ${a.id} is not placed yet; it has no tasks`);
      deployedObserver(p.observedBy, a.cityId, a.id);
      break;
    }
    case 'agent.school_returned':
      missed();
      if (!canMissKpi(agent!)) conflict(`agent ${agent!.id} is ${agent!.state}; only graduated department agents can miss KPI; professors take teaching strikes`);
      if (agent!.strikes >= MAX_STRIKES - 1) conflict(`miss #${agent!.strikes + 1} is the 3rd strike; write agent.third_strike`);
      break;
    case 'agent.third_strike':
      missed();
      if (!canMissKpi(agent!)) conflict(`agent ${agent!.id} is ${agent!.state}; only graduated department agents can miss KPI; professors take teaching strikes`);
      if (agent!.strikes !== MAX_STRIKES - 1) conflict(`3rd strike requires ${MAX_STRIKES - 1} prior strikes (agent has ${agent!.strikes})`);
      break;
    case 'agent.deleted':
      intentAgent();
      if (!isJailed(agent!, now) || agent!.jail!.status !== 'awaiting_deletion') {
        conflict(`deletion only for an agent jailed awaiting deletion (3rd KPI strike, or 4th task-strike jailing)`);
      }
      break;
  }
}
