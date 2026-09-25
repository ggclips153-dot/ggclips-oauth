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
  'agent.graduated',
  'agent.promoted',
  'agent.lead_assigned',
  'agent.moved',
  'agent.school_returned',
  'agent.third_strike',
  'intent.promote_agent',
  'intent.move_agent',
]);

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
  const slotFree = (deptId: string) => {
    const dept = state.departments.get(deptId)!;
    if (state.departmentAgents(deptId).length >= dept.slots) conflict(`department ${deptId} has no free agent slot (${dept.slots})`);
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

  switch (d.type) {
    // ---- intents: early checks so Marc sees mistakes before the DM routes them ----
    case 'intent.create_city': {
      const list = p.initialDistricts;
      if (list !== undefined) {
        if (!Array.isArray(list) || list.length > 50) invalid('initialDistricts must be a list (max 50)');
        for (const item of list) validate({ name: { t: 'str', max: 120 }, supervisor: { t: 'str', max: 120 } }, item, 'initialDistricts[]');
      }
      break;
    }
    case 'intent.create_department': {
      const dist = state.districts.get(String(p.districtId)) ?? notFound(`unknown district: ${p.districtId}`);
      if (dist.cityId !== d.city) forbid(`district ${dist.id} is not in ${d.city}`);
      break;
    }
    case 'intent.create_agent':
      departmentIn(p.departmentId, d.city);
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

    // ---- DM ----
    case 'dm.routed': {
      const target = state.intents.get(p.intentSeq) ?? notFound(`intent #${p.intentSeq} not found`);
      if (target.city !== d.city) forbid(`dm.routed city tag must match intent #${target.seq} (${target.city})`);
      if (state.routed.has(target.seq)) conflict(`intent #${target.seq} is already routed`);
      break;
    }
    case 'city.created':
      match(['name', 'family', 'mayorName']);
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
      match(['districtId', 'name', 'scope', 'slots', 'botTokenRef']);
      const dist = state.districts.get(String(p.districtId)) ?? notFound(`unknown district: ${p.districtId}`);
      if (dist.cityId !== d.city) forbid(`district ${dist.id} is not in ${d.city}`);
      break;
    }

    // ---- Mayor: agent lifecycle ----
    case 'agent.enrolled':
      match(['name', 'persona', 'domainFocus', 'departmentId']);
      departmentIn(p.departmentId, d.city);
      if (state.isNameRetired(p.name)) conflict(`name "${p.name}" belonged to a deleted agent and is retired forever`);
      break;
    case 'agent.placed':
      if (agent!.state !== 'enrolled') conflict(`agent ${agent!.id} is already placed`);
      if (intent!.type === 'intent.create_agent') {
        if (agent!.enrolledBy !== intent!.seq) forbid(`intent #${intent!.seq} did not enroll ${agent!.id}`);
        if (p.departmentId !== agent!.assignedDepartmentId) forbid(`placement must be the assigned department ${agent!.assignedDepartmentId}`);
      } else {
        intentAgent();
        match(['departmentId']);
      }
      departmentIn(p.departmentId, d.city);
      slotFree(p.departmentId);
      break;
    case 'agent.graduated':
      intentAgent();
      if (ip.to !== 'probationer') forbid(`intent #${intent!.seq} promotes to ${ip.to}, not probationer`);
      if (agent!.state !== 'student') conflict(`only a student graduates (agent is ${agent!.state})`);
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
      const members = state.departmentAgents(agent!.departmentId!);
      if (members.length < DEPT_LEAD_MIN_AGENTS) conflict(`${DEPT_LEAD_BADGE} only when a department has ${DEPT_LEAD_MIN_AGENTS}+ agents`);
      if (members.some((a) => a.badges.includes(DEPT_LEAD_BADGE))) conflict(`department already has a ${DEPT_LEAD_BADGE}`);
      break;
    }
    case 'agent.moved':
      intentAgent();
      match(['toDepartmentId']);
      if (!agent!.departmentId) conflict(`agent ${agent!.id} is not placed yet`);
      if (agent!.departmentId === p.toDepartmentId) conflict(`agent ${agent!.id} is already in ${p.toDepartmentId}`);
      departmentIn(p.toDepartmentId, d.city);
      slotFree(p.toDepartmentId);
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
      if (a.state === 'enrolled') conflict(`agent ${a.id} is not placed yet; it has no tasks`);
      const obs = state.agents.get(String(p.observedBy)) ?? notFound(`unknown observer: ${p.observedBy}`);
      if (obs.cityId !== SECURITY_CITY_ID || obs.deleted) forbid(`observer ${obs.id} is not a Security City agent`);
      if (obs.id === a.id) forbid('an agent cannot strike itself');
      if (obs.deployedTo !== a.cityId) forbid(`observer ${obs.id} is not deployed to ${a.cityId}`);
      if (isJailed(obs, now)) conflict(`observer ${obs.id} is in jail`);
      break;
    }
    case 'agent.school_returned':
      missed();
      if (!['probationer', 'active', 'senior'].includes(agent!.state)) conflict(`agent ${agent!.id} is ${agent!.state}; only graduated agents can miss KPI`);
      if (agent!.strikes >= MAX_STRIKES - 1) conflict(`miss #${agent!.strikes + 1} is the 3rd strike; write agent.third_strike`);
      break;
    case 'agent.third_strike':
      missed();
      if (!['probationer', 'active', 'senior'].includes(agent!.state)) conflict(`agent ${agent!.id} is ${agent!.state}; only graduated agents can miss KPI`);
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
