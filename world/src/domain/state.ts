// World state PROJECTION. Rebuilt purely from the event ledger; the dashboard never owns state.
import type { EventKind } from '../ledger/catalog.ts';
import { SocialState } from '../social/state.ts';
import type { Payload } from '../ledger/validate.ts';
import {
  AGENT_STATES,
  DEPT_LEAD_BADGE,
  INTERN_BADGE,
  MAX_STRIKES,
  JAIL_TERMS_HOURS,
  TASK_STRIKES_PER_JAIL,
  type AgentState,
  type Family,
  type LifecycleStage,
  type Role,
} from './model.ts';

export interface LedgerEvent {
  seq: number;
  ts: string;
  kind: EventKind;
  type: string;
  /** The `city=` tag. WORLD for world events. */
  city: string;
  actor: string;
  actorRole: Role;
  subject: string | null;
  payload: Payload;
  authorizedBy: number | null;
  prevHash: string;
  hash: string;
}

export interface KpiPulse {
  seq: number;
  ts: string;
  metric: string;
  value: number;
  target: number | null;
  period: string;
  periodStart: string;
  secondaryMetric: string | null;
  secondaryValue: number | null;
}

export interface City {
  id: string;
  name: string;
  family: Family;
  mayorName: string;
  createdAt: string;
  /** The owner intent that created this city. */
  createdBy: number;
  kpi: KpiPulse | null;
  kpiHistory: KpiPulse[];
  lastHealthReport: { seq: number; weekOf: string; summary: string; ref: string | null } | null;
}

export interface District {
  id: string;
  cityId: string;
  name: string;
  supervisor: string;
}

export interface Department {
  id: string;
  cityId: string;
  districtId: string;
  name: string;
  scope: string;
  botTokenRef: string | null;
  /** Caps set by Marc (A9). null = no cap. */
  maxGraduated: number | null;
  maxShadows: number | null;
  /** Approved basic tasks graduated agents may delegate to shadows. */
  basicTasks: string[];
}

/** A department asking for an unfilled role; the Mayor answers by sending a professor (A11). */
export interface RoleRequest {
  seq: number;
  ts: string;
  cityId: string;
  departmentId: string;
  role: string;
  filledBy: { professorId: string; seq: number } | null;
}

export interface Delegation {
  seq: number;
  ts: string;
  cityId: string;
  departmentId: string;
  fromAgentId: string;
  toAgentId: string;
  task: string;
  details: string | null;
  returned: { seq: number; ts: string; outcome: string; resultRef: string | null } | null;
}

export interface LifecycleEntry {
  stage: LifecycleStage;
  seq: number;
  ts: string;
  detail?: string;
}

export interface Agent {
  // ---- canonical identity record (anchor) ----
  id: string;
  name: string;
  cityId: string;
  /**
   * `agent` = works in departments. `professor` = belongs to the city's college (A10, A11): teaches,
   * examines, and steps in only at its specialty department when needed. `dean` = runs the college's
   * professors (A14); the Mayor judges it.
   */
  role: 'agent' | 'professor' | 'dean';
  /** Placement card: current department (null at the college: enrolled, or a professor). */
  departmentId: string | null;
  /** Tier. */
  state: AgentState;
  badges: string[];
  graduated: boolean;
  /** Ledger pointer: the agent's own daily ledger. */
  ledgerPointer: string;
  /** Own memory bank scope, separable from the department's. */
  memoryScope: string;
  // ---- profile ----
  persona: { voice: string; temperament: string } | null;
  domainFocus: string;
  enrolledBy: number;
  strikes: number;
  status: { status: string; activity: string | null; ts: string; seq: number } | null;
  lifecycle: LifecycleEntry[];
  deleted: { seq: number; ts: string; ledgerArchiveRef: string; lessonRecordRef: string } | null;
  /** Task strikes toward the next jail term (separate from KPI `strikes`). Resets after each term. */
  taskStrikes: number;
  /** Jail terms from task strikes so far. Never resets. */
  jailTerms: number;
  /** Latest jail record. A timed term ends on its own at `until`; see isJailed(). */
  jail: Jail | null;
  /** Security City agents only: the city it is deployed to watch. */
  deployedTo: string | null;
  /** Latest exam from a professor. A pass is required to graduate; reset on each return to school. */
  lastExam: { seq: number; ts: string; professorId: string; result: 'pass' | 'fail' } | null;
  /** Professors only: the department it specialises in (may be none yet). */
  specialtyDepartmentId: string | null;
  /** Professors only: temporarily filling a role in a department; ends on its own at `until`. */
  steppedIn: { departmentId: string; role: string; seq: number; ts: string; until: string } | null;
  /** Set when a senior agent was retired into a professor. */
  professorSince: string | null;
  /** Professors only: the teaching record the school system judges them on. */
  teaching: { examsGiven: number; examsPassed: number; graduates: number } | null;
  /** Deans only: graduates of its college while in office (judged on how they perform), and the Mayor's reviews. */
  dean: { since: string; graduates: string[]; reviews: { seq: number; ts: string; rating: string; notes: string }[] } | null;
}

/** A deliverable credited to the agent that owns its deciding artifact (clean attribution). */
export interface Deliverable {
  seq: number;
  ts: string;
  cityId: string;
  agentId: string;
  artifactRef: string;
  revenue: 'real' | 'synthetic';
  revenueRef: string | null;
  revenueCents: number | null;
  periodStart: string;
  description: string;
  /** The currency.earned event that credited it, if any. */
  creditedSeq: number | null;
}

/** One line of the currency ledger. No agent holds or spends currency: the Mayor + Marc keep these accounts. */
export interface CurrencyEntry {
  seq: number;
  ts: string;
  cityId: string;
  agentId: string;
  kind: 'earned' | 'spent';
  amountCents: number;
  deliverableSeq: number | null;
  reward: string | null;
  detail: string | null;
}

/** A dean's report of work not being done, and Security's escalation of it to Marc. */
export interface DeanReport {
  seq: number;
  ts: string;
  cityId: string;
  deanId: string;
  agentId: string;
  reason: string;
  evidence: string;
  evidenceRef: string | null;
  escalated: { seq: number; ts: string; summary: string } | null;
}

export interface Jail {
  status: 'serving' | 'awaiting_deletion';
  cause: 'kpi_strikes' | 'task_strikes' | 'teaching_strikes';
  /** Task-strike term number (1 = 6h, 2 = 24h, 3 = 3 days, 4 = awaiting deletion). */
  term: number | null;
  seq: number;
  ts: string;
  /** End of a timed term; null = held until Marc decides on deletion. */
  until: string | null;
}

export interface TaskStrike {
  seq: number;
  ts: string;
  agentId: string;
  agentCity: string;
  observedBy: string;
  task: string;
  evidence: string;
  evidenceRef: string | null;
}

/** In jail right now? Timed terms release on their own once `until` passes. */
export function isJailed(a: Agent, now: Date): boolean {
  if (!a.jail || a.deleted) return false;
  return a.jail.until === null || Date.parse(a.jail.until) > now.getTime();
}

export interface ConstitutionVersion {
  version: string;
  docRef: string;
  sha256: string;
  summary: string;
  proposalSeq: number | null;
  seq: number;
  ts: string;
}

export interface Constitution {
  current: ConstitutionVersion | null;
  /** Every ratified version, oldest first. */
  history: ConstitutionVersion[];
}

export interface ConstitutionProposal {
  seq: number;
  ts: string;
  /** Proposing city tag (Innovations / Security) or WORLD for Bob via the DM. */
  city: string;
  proposer: string;
  title: string;
  rationale: string;
  text: string;
  status: 'open' | 'ratified' | 'declined';
  decidedSeq: number | null;
  ratifiedAs: string | null;
  declineReason: string | null;
}

const KPI_HISTORY = 52;

const GRADUATED_STATES = new Set<AgentState>(['probationer', 'active', 'senior']);

export const agentLedgerPointer = (id: string) => `agents/${id}/ledger/`;
export const agentMemoryScope = (id: string) => `agents/${id}/memory/`;

const nameKey = (name: string) => name.trim().toLowerCase();

export class WorldState {
  lastSeq = 0;
  lastHash = '';
  readonly cities = new Map<string, City>();
  readonly districts = new Map<string, District>();
  readonly departments = new Map<string, Department>();
  readonly agents = new Map<string, Agent>();
  readonly delegations = new Map<number, Delegation>();
  readonly roleRequests = new Map<number, RoleRequest>();
  readonly deanReports = new Map<number, DeanReport>();
  readonly deliverables = new Map<number, Deliverable>();
  /** `${agentId}|${periodStart}` -> QC reworks that week. */
  readonly reworks = new Map<string, number>();
  readonly currency: CurrencyEntry[] = [];
  readonly intents = new Map<number, LedgerEvent>();
  /** Marc's direct conversations with agents: agentId -> messages, oldest first (last CHAT_KEEP kept). */
  readonly chats = new Map<string, ChatMessage[]>();
  private chat(agentId: string, m: ChatMessage) {
    if (!this.chats.has(agentId)) this.chats.set(agentId, []);
    const list = this.chats.get(agentId)!;
    list.push(m);
    if (list.length > CHAT_KEEP) list.shift();
  }
  /** intent seq -> dm.routed seq */
  readonly routed = new Map<number, number>();
  /** `${intentSeq}|${factType}|${key}` once an intent has been fulfilled by that fact. */
  readonly consumed = new Set<string>();
  /** Names of deleted agents: retired forever. */
  readonly retiredNames = new Set<string>();
  /** Task strikes recorded by Security City, oldest first. */
  readonly taskStrikes: TaskStrike[] = [];
  constitution: Constitution = { current: null, history: [] };
  /** Social media: channels, posts, inbox, metrics (src/social). */
  readonly social = new SocialState();
  readonly proposals = new Map<number, ConstitutionProposal>();
  worldRollup: { seq: number; period: string; periodStart: string; rollup: unknown } | null = null;

  isNameRetired(name: string) {
    return this.retiredNames.has(nameKey(name));
  }

  /** Living professors (the college). */
  professors(cityId?: string): Agent[] {
    return [...this.agents.values()].filter((a) => a.role === 'professor' && !a.deleted && (!cityId || a.cityId === cityId));
  }

  /** An agent's account, kept by the Mayor + Marc (the agent never holds it). */
  account(agentId: string) {
    let earnedCents = 0;
    let spentCents = 0;
    const rewards: string[] = [];
    for (const c of this.currency) {
      if (c.agentId !== agentId) continue;
      if (c.kind === 'earned') earnedCents += c.amountCents;
      else {
        spentCents += c.amountCents;
        rewards.push(c.reward!);
      }
    }
    return { earnedCents, spentCents, balanceCents: earnedCents - spentCents, rewards };
  }

  reworksIn(agentId: string, periodStart: string) {
    return this.reworks.get(`${agentId}|${periodStart}`) ?? 0;
  }

  /** The college's living dean, if any. */
  deanOf(cityId: string): Agent | undefined {
    return [...this.agents.values()].find((a) => a.role === 'dean' && !a.deleted && a.cityId === cityId);
  }

  /** Living agents placed in the department (students, interns and graduated; not deleted). */
  departmentAgents(departmentId: string): Agent[] {
    return [...this.agents.values()].filter((a) => !a.deleted && a.departmentId === departmentId);
  }

  /** Graduated ("fully working") agents in the department. The only ones that count toward dept-lead. */
  graduatedIn(departmentId: string): Agent[] {
    return this.departmentAgents(departmentId).filter((a) => GRADUATED_STATES.has(a.state));
  }

  /** Shadows (interns) in the department. */
  shadowsIn(departmentId: string): Agent[] {
    return this.departmentAgents(departmentId).filter((a) => a.badges.includes(INTERN_BADGE));
  }

  cityAgentCounts(cityId: string): Record<AgentState, number> {
    const counts = Object.fromEntries(AGENT_STATES.map((s) => [s, 0])) as Record<AgentState, number>;
    for (const a of this.agents.values()) {
      if (a.cityId === cityId && !a.deleted && a.role === 'agent') counts[a.state]++;
    }
    return counts;
  }

  apply(e: LedgerEvent): void {
    this.lastSeq = e.seq;
    this.lastHash = e.hash;
    if (e.kind === 'intent') {
      this.intents.set(e.seq, e);
      if (e.type === 'intent.message_agent') this.chat(String((e.payload as Record<string, unknown>).agentId), { seq: e.seq, ts: e.ts, from: 'marc', text: String((e.payload as Record<string, unknown>).text) });
      return;
    }
    const p = e.payload as Record<string, any>;
    const agent = e.subject ? this.agents.get(e.subject) : undefined;
    const mark = (stage: LifecycleStage, detail?: string) =>
      agent?.lifecycle.push({ stage, seq: e.seq, ts: e.ts, ...(detail ? { detail } : {}) });

    switch (e.type) {
      case 'dm.routed':
        this.routed.set(p.intentSeq, e.seq);
        break;
      case 'city.created':
        this.cities.set(e.subject!, {
          id: e.subject!,
          name: p.name,
          family: p.family,
          mayorName: p.mayorName,
          createdAt: e.ts,
          createdBy: e.authorizedBy!,
          kpi: null,
          kpiHistory: [],
          lastHealthReport: null,
        });
        break;
      case 'constitution.amended': {
        const v: ConstitutionVersion = {
          version: p.version,
          docRef: p.docRef,
          sha256: p.sha256,
          summary: p.summary,
          proposalSeq: p.proposalSeq ?? null,
          seq: e.seq,
          ts: e.ts,
        };
        this.constitution.current = v;
        this.constitution.history.push(v);
        const prop = v.proposalSeq ? this.proposals.get(v.proposalSeq) : undefined;
        if (prop) Object.assign(prop, { status: 'ratified', decidedSeq: e.seq, ratifiedAs: v.version });
        break;
      }
      case 'constitution.proposed':
        this.proposals.set(e.seq, {
          seq: e.seq,
          ts: e.ts,
          city: e.city,
          proposer: p.proposer,
          title: p.title,
          rationale: p.rationale,
          text: p.text,
          status: 'open',
          decidedSeq: null,
          ratifiedAs: null,
          declineReason: null,
        });
        break;
      case 'constitution.declined': {
        const prop = this.proposals.get(p.proposalSeq);
        if (prop) Object.assign(prop, { status: 'declined', decidedSeq: e.seq, declineReason: p.reason });
        break;
      }
      case 'world.kpi_rollup':
        this.worldRollup = { seq: e.seq, period: p.period, periodStart: p.periodStart, rollup: p.rollup };
        break;
      case 'district.created':
        this.districts.set(e.subject!, { id: e.subject!, cityId: e.city, name: p.name, supervisor: p.supervisor });
        break;
      case 'department.created':
        this.departments.set(e.subject!, {
          id: e.subject!,
          cityId: e.city,
          districtId: p.districtId,
          name: p.name,
          scope: p.scope,
          botTokenRef: p.botTokenRef ?? null,
          maxGraduated: p.maxGraduated ?? null,
          maxShadows: p.maxShadows ?? null,
          basicTasks: p.basicTasks ?? [],
        });
        break;
      case 'district.renamed': {
        const dist = this.districts.get(p.districtId);
        if (!dist) break;
        dist.name = p.name;
        if (p.supervisor) dist.supervisor = p.supervisor;
        break;
      }
      case 'department.renamed': {
        const dept = this.departments.get(p.departmentId);
        if (!dept) break;
        dept.name = p.name;
        if (p.scope) dept.scope = p.scope;
        break;
      }
      case 'district.deleted':
        this.districts.delete(p.districtId);
        break;
      case 'department.deleted':
        this.departments.delete(p.departmentId);
        // Professors who specialised in it keep teaching at the college, with no specialty for now.
        for (const a of this.agents.values()) {
          if (a.specialtyDepartmentId === p.departmentId) a.specialtyDepartmentId = null;
          if (a.steppedIn?.departmentId === p.departmentId) a.steppedIn = null;
        }
        break;
      case 'department.configured': {
        const dept = this.departments.get(p.departmentId);
        if (!dept) break;
        dept.maxGraduated = p.maxGraduated ?? null;
        dept.maxShadows = p.maxShadows ?? null;
        dept.basicTasks = p.basicTasks ?? [];
        break;
      }
      case 'professor.enrolled':
        this.agents.set(e.subject!, {
          ...newAgent(e, p),
          role: 'professor',
          state: 'senior',
          specialtyDepartmentId: p.departmentId ?? null,
          professorSince: e.ts,
          teaching: { examsGiven: 0, examsPassed: 0, graduates: 0 },
        });
        break;
      case 'agent.retired_to_professor':
        if (!agent) break;
        agent.role = 'professor';
        agent.specialtyDepartmentId = p.departmentId ?? agent.departmentId;
        agent.departmentId = null;
        agent.badges = agent.badges.filter((b) => b !== DEPT_LEAD_BADGE);
        agent.professorSince = e.ts;
        agent.teaching = { examsGiven: 0, examsPassed: 0, graduates: 0 };
        // A professor's strikes are teaching strikes (A13): KPI strikes from its agent career don't carry over.
        agent.strikes = 0;
        agent.deployedTo = null;
        break;
      case 'professor.specialized': {
        const prof = this.agents.get(p.professorId);
        if (prof) prof.specialtyDepartmentId = p.departmentId;
        break;
      }
      case 'department.role_requested':
        this.roleRequests.set(e.seq, { seq: e.seq, ts: e.ts, cityId: e.city, departmentId: p.departmentId, role: p.role, filledBy: null });
        break;
      case 'professor.stepped_in': {
        const prof = this.agents.get(p.professorId);
        if (prof) {
          const until = new Date(Date.parse(e.ts) + p.hours * 3_600_000).toISOString();
          prof.steppedIn = { departmentId: p.departmentId, role: p.role, seq: e.seq, ts: e.ts, until };
        }
        const req = p.requestSeq ? this.roleRequests.get(p.requestSeq) : undefined;
        if (req) req.filledBy = { professorId: p.professorId, seq: e.seq };
        break;
      }
      case 'dean.appointed':
        this.agents.set(e.subject!, {
          ...newAgent(e, p),
          role: 'dean',
          state: 'senior',
          dean: { since: e.ts, graduates: [], reviews: [] },
        });
        break;
      case 'dean.replaced': {
        // The outgoing dean returns to teaching at the college; the professor takes office with a fresh scorecard.
        const outgoing = this.deanOf(e.city);
        if (outgoing) {
          outgoing.role = 'professor';
          outgoing.dean = null;
          outgoing.teaching ??= { examsGiven: 0, examsPassed: 0, graduates: 0 };
          outgoing.professorSince ??= e.ts;
        }
        const incoming = this.agents.get(p.professorId);
        if (incoming) {
          incoming.role = 'dean';
          incoming.steppedIn = null;
          incoming.dean = { since: e.ts, graduates: [], reviews: [] };
        }
        break;
      }
      case 'dean.reviewed':
        this.agents.get(p.deanId)?.dean?.reviews.push({ seq: e.seq, ts: e.ts, rating: p.rating, notes: p.notes });
        break;
      case 'dean.reported':
        this.deanReports.set(e.seq, {
          seq: e.seq,
          ts: e.ts,
          cityId: e.city,
          deanId: p.deanId,
          agentId: p.agentId,
          reason: p.reason,
          evidence: p.evidence,
          evidenceRef: p.evidenceRef ?? null,
          escalated: null,
        });
        break;
      case 'work.deliverable':
        this.deliverables.set(e.seq, {
          seq: e.seq,
          ts: e.ts,
          cityId: e.city,
          agentId: p.agentId,
          artifactRef: p.artifactRef,
          revenue: p.revenue,
          revenueRef: p.revenueRef ?? null,
          revenueCents: p.revenueCents ?? null,
          periodStart: p.periodStart,
          description: p.description,
          creditedSeq: null,
        });
        break;
      case 'work.qc_rework': {
        const key = `${p.agentId}|${p.periodStart}`;
        this.reworks.set(key, (this.reworks.get(key) ?? 0) + 1);
        break;
      }
      case 'currency.earned': {
        const d = this.deliverables.get(p.deliverableSeq);
        if (d) d.creditedSeq = e.seq;
        this.currency.push({ seq: e.seq, ts: e.ts, cityId: e.city, agentId: p.agentId, kind: 'earned', amountCents: p.amountCents, deliverableSeq: p.deliverableSeq, reward: null, detail: null });
        break;
      }
      case 'currency.spent':
        this.currency.push({ seq: e.seq, ts: e.ts, cityId: e.city, agentId: p.agentId, kind: 'spent', amountCents: p.amountCents, deliverableSeq: null, reward: p.reward, detail: p.detail });
        break;
      case 'security.escalated': {
        const report = this.deanReports.get(p.reportSeq);
        if (report) report.escalated = { seq: e.seq, ts: e.ts, summary: p.summary };
        break;
      }
      case 'professor.strike': {
        const prof = this.agents.get(p.professorId);
        if (!prof) break;
        prof.strikes += 1;
        // Professors aren't sent to school; only the 3rd strike appears on the lifecycle strip.
        if (prof.strikes >= MAX_STRIKES) {
          prof.lifecycle.push({ stage: '3rd-strike', seq: e.seq, ts: e.ts, detail: `teaching: ${p.rule}` });
          prof.jail = { status: 'awaiting_deletion', cause: 'teaching_strikes', term: null, seq: e.seq, ts: e.ts, until: null };
        }
        break;
      }
      case 'exam.graded': {
        const prof = this.agents.get(p.professorId);
        if (prof?.teaching) {
          prof.teaching.examsGiven += 1;
          if (p.result === 'pass') prof.teaching.examsPassed += 1;
        }
        if (!agent) break;
        agent.lastExam = { seq: e.seq, ts: e.ts, professorId: p.professorId, result: p.result };
        mark('school', `exam ${p.result}`);
        break;
      }
      case 'task.delegated': {
        const to = agent!;
        this.delegations.set(e.seq, {
          seq: e.seq,
          ts: e.ts,
          cityId: e.city,
          departmentId: to.departmentId!,
          fromAgentId: p.fromAgentId,
          toAgentId: to.id,
          task: p.task,
          details: p.details ?? null,
          returned: null,
        });
        break;
      }
      case 'task.returned': {
        const del = this.delegations.get(p.delegationSeq);
        if (del) del.returned = { seq: e.seq, ts: e.ts, outcome: p.outcome, resultRef: p.resultRef ?? null };
        break;
      }
      case 'agent.enrolled':
        this.agents.set(e.subject!, newAgent(e, p));
        break;
      case 'agent.placed':
        if (!agent) break;
        agent.departmentId = p.departmentId;
        agent.state = 'student';
        mark('school');
        break;
      case 'agent.interned':
        if (!agent) break;
        agent.badges.push(INTERN_BADGE);
        mark('school', INTERN_BADGE);
        break;
      case 'agent.graduated':
        if (!agent) break;
        agent.badges = agent.badges.filter((b) => b !== INTERN_BADGE);
        // Credit the professor whose exam cleared this graduation.
        const examiner = agent.lastExam ? this.agents.get(agent.lastExam.professorId) : undefined;
        if (examiner?.teaching) examiner.teaching.graduates += 1;
        this.deanOf(agent.cityId)?.dean?.graduates.push(agent.id);
        agent.lastExam = null;
        agent.state = 'probationer';
        agent.graduated = true;
        mark('graduation');
        break;
      case 'agent.promoted':
        if (!agent) break;
        agent.state = p.to;
        mark(p.to === 'active' ? 'active' : 'promotion', p.to);
        break;
      case 'agent.lead_assigned':
        if (!agent) break;
        agent.badges.push(DEPT_LEAD_BADGE);
        mark('promotion', DEPT_LEAD_BADGE);
        break;
      case 'agent.moved':
        if (!agent) break;
        agent.departmentId = p.toDepartmentId;
        // An exam is for one department: a pass there doesn't graduate the agent somewhere else.
        agent.lastExam = null;
        // A lead badge belongs to a department; it does not travel.
        agent.badges = agent.badges.filter((b) => b !== DEPT_LEAD_BADGE);
        break;
      case 'agent.school_returned':
        if (!agent) break;
        agent.strikes += 1;
        // A professor keeps its post at the college: the strike counts, but it isn't sent to school.
        if (agent.role === 'agent') {
          agent.state = 'student';
          // Back in school: no longer fit to serve as a deployed Security observer.
          agent.deployedTo = null;
        }
        agent.badges = agent.badges.filter((b) => b !== DEPT_LEAD_BADGE);
        agent.lastExam = null;
        mark('school-return', `strike ${agent.strikes}`);
        break;
      case 'agent.third_strike':
        if (!agent) break;
        agent.strikes += 1;
        // Waiting for deletion: held in Security's jail.
        agent.jail = { status: 'awaiting_deletion', cause: 'kpi_strikes', term: null, seq: e.seq, ts: e.ts, until: null };
        mark('3rd-strike');
        break;
      case 'agent.deployed':
        if (agent) agent.deployedTo = p.toCity;
        break;
      case 'security.task_strike': {
        const target = this.agents.get(p.agentId);
        this.taskStrikes.push({
          seq: e.seq,
          ts: e.ts,
          agentId: p.agentId,
          agentCity: target?.cityId ?? '',
          observedBy: p.observedBy,
          task: p.task,
          evidence: p.evidence,
          evidenceRef: p.evidenceRef ?? null,
        });
        if (!target) break;
        target.taskStrikes += 1;
        if (target.taskStrikes < TASK_STRIKES_PER_JAIL) break;
        target.taskStrikes = 0;
        target.jailTerms += 1;
        const hours = JAIL_TERMS_HOURS[target.jailTerms - 1];
        target.jail =
          hours === undefined
            ? { status: 'awaiting_deletion', cause: 'task_strikes', term: target.jailTerms, seq: e.seq, ts: e.ts, until: null }
            : {
                status: 'serving',
                cause: 'task_strikes',
                term: target.jailTerms,
                seq: e.seq,
                ts: e.ts,
                until: new Date(Date.parse(e.ts) + hours * 3_600_000).toISOString(),
              };
        break;
      }
      case 'agent.deleted':
        if (!agent) break;
        agent.deleted = {
          seq: e.seq,
          ts: e.ts,
          ledgerArchiveRef: p.ledgerArchiveRef,
          lessonRecordRef: p.lessonRecordRef,
        };
        agent.departmentId = null;
        agent.status = null;
        agent.jail = null;
        agent.steppedIn = null;
        this.retiredNames.add(nameKey(agent.name));
        mark('deletion');
        break;
      case 'agent.said':
        if (agent) this.chat(agent.id, { seq: e.seq, ts: e.ts, from: 'agent', text: p.text, replyTo: p.replyTo ?? null });
        break;
      case 'agent.status':
        if (!agent) break;
        agent.status = { status: p.status, activity: p.activity ?? null, ts: e.ts, seq: e.seq };
        break;
      case 'city.kpi_pulse': {
        const city = this.cities.get(e.city);
        if (!city) break;
        const pulse: KpiPulse = {
          seq: e.seq,
          ts: e.ts,
          metric: p.metric,
          value: p.value,
          target: p.target ?? null,
          period: p.period,
          periodStart: p.periodStart,
          secondaryMetric: p.secondaryMetric ?? null,
          secondaryValue: p.secondaryValue ?? null,
        };
        city.kpi = pulse;
        city.kpiHistory.push(pulse);
        if (city.kpiHistory.length > KPI_HISTORY) city.kpiHistory.shift();
        break;
      }
      case 'city.health_report': {
        const city = this.cities.get(e.city);
        if (city) city.lastHealthReport = { seq: e.seq, weekOf: p.weekOf, summary: p.summary, ref: p.ref ?? null };
        break;
      }
    }

    if (e.type.startsWith('social.')) this.social.apply(e);
    if (e.authorizedBy !== null) this.consumed.add(consumeKey(e));
  }
}

export interface ChatMessage {
  seq: number;
  ts: string;
  from: 'marc' | 'agent';
  text: string;
  replyTo?: number | null;
}
const CHAT_KEEP = 200;

/** A fresh identity record at the college: enrolled, unplaced. */
function newAgent(e: LedgerEvent, p: Record<string, any>): Agent {
  const id = e.subject!;
  return {
    id,
    name: p.name,
    cityId: e.city,
    role: 'agent',
    departmentId: null,
    state: 'enrolled',
    badges: [],
    graduated: false,
    ledgerPointer: agentLedgerPointer(id),
    memoryScope: agentMemoryScope(id),
    persona: p.persona ?? null,
    domainFocus: p.domainFocus,
    enrolledBy: e.authorizedBy!,
    strikes: 0,
    status: null,
    lifecycle: [{ stage: 'enrollment', seq: e.seq, ts: e.ts }],
    deleted: null,
    taskStrikes: 0,
    jailTerms: 0,
    jail: null,
    deployedTo: null,
    lastExam: null,
    specialtyDepartmentId: null,
    steppedIn: null,
    professorSince: null,
    teaching: null,
    dean: null,
  };
}

/** One intent authorizes each fact type once (per district name for a city's initial districts). */
export function consumeKey(e: Pick<LedgerEvent, 'authorizedBy' | 'type' | 'payload'>): string {
  const key = e.type === 'district.created' ? nameKey(String(e.payload.name)) : '';
  return `${e.authorizedBy}|${e.type}|${key}`;
}
