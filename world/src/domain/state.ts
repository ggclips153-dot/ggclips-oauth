// World state PROJECTION. Rebuilt purely from the event ledger; the dashboard never owns state.
import type { EventKind } from '../ledger/catalog.ts';
import type { Payload } from '../ledger/validate.ts';
import {
  AGENT_STATES,
  DEPT_LEAD_BADGE,
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
  slots: number;
  botTokenRef: string | null;
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
  /** Placement card: current department (null while enrolled, before placement). */
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
  persona: { voice: string; temperament: string };
  domainFocus: string;
  assignedDepartmentId: string;
  enrolledBy: number;
  strikes: number;
  status: { status: string; activity: string | null; ts: string; seq: number } | null;
  lifecycle: LifecycleEntry[];
  deleted: { seq: number; ts: string; ledgerArchiveRef: string; lessonRecordRef: string } | null;
}

export interface Constitution {
  version: string;
  docRef: string;
  summary: string;
  seq: number;
  ts: string;
}

const KPI_HISTORY = 52;

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
  readonly intents = new Map<number, LedgerEvent>();
  /** intent seq -> dm.routed seq */
  readonly routed = new Map<number, number>();
  /** `${intentSeq}|${factType}|${key}` once an intent has been fulfilled by that fact. */
  readonly consumed = new Set<string>();
  /** Names of deleted agents: retired forever. */
  readonly retiredNames = new Set<string>();
  constitution: Constitution | null = null;
  worldRollup: { seq: number; period: string; periodStart: string; rollup: unknown } | null = null;

  isNameRetired(name: string) {
    return this.retiredNames.has(nameKey(name));
  }

  /** Living agents currently filling a slot in the department (placed, not deleted). */
  departmentAgents(departmentId: string): Agent[] {
    return [...this.agents.values()].filter((a) => !a.deleted && a.departmentId === departmentId);
  }

  cityAgentCounts(cityId: string): Record<AgentState, number> {
    const counts = Object.fromEntries(AGENT_STATES.map((s) => [s, 0])) as Record<AgentState, number>;
    for (const a of this.agents.values()) {
      if (a.cityId === cityId && !a.deleted) counts[a.state]++;
    }
    return counts;
  }

  apply(e: LedgerEvent): void {
    this.lastSeq = e.seq;
    this.lastHash = e.hash;
    if (e.kind === 'intent') {
      this.intents.set(e.seq, e);
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
      case 'constitution.amended':
        this.constitution = { version: p.version, docRef: p.docRef, summary: p.summary, seq: e.seq, ts: e.ts };
        break;
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
          slots: p.slots,
          botTokenRef: p.botTokenRef ?? null,
        });
        break;
      case 'agent.enrolled': {
        const id = e.subject!;
        this.agents.set(id, {
          id,
          name: p.name,
          cityId: e.city,
          departmentId: null,
          state: 'enrolled',
          badges: [],
          graduated: false,
          ledgerPointer: agentLedgerPointer(id),
          memoryScope: agentMemoryScope(id),
          persona: p.persona,
          domainFocus: p.domainFocus,
          assignedDepartmentId: p.departmentId,
          enrolledBy: e.authorizedBy!,
          strikes: 0,
          status: null,
          lifecycle: [{ stage: 'enrollment', seq: e.seq, ts: e.ts }],
          deleted: null,
        });
        break;
      }
      case 'agent.placed':
        if (!agent) break;
        agent.departmentId = p.departmentId;
        agent.state = 'student';
        mark('school');
        break;
      case 'agent.graduated':
        if (!agent) break;
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
        // A lead badge belongs to a department; it does not travel.
        agent.badges = agent.badges.filter((b) => b !== DEPT_LEAD_BADGE);
        break;
      case 'agent.school_returned':
        if (!agent) break;
        agent.strikes += 1;
        agent.state = 'student';
        agent.badges = agent.badges.filter((b) => b !== DEPT_LEAD_BADGE);
        mark('school-return', `strike ${agent.strikes}`);
        break;
      case 'agent.third_strike':
        if (!agent) break;
        agent.strikes += 1;
        mark('3rd-strike');
        break;
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
        this.retiredNames.add(nameKey(agent.name));
        mark('deletion');
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

    if (e.authorizedBy !== null) this.consumed.add(consumeKey(e));
  }
}

/** One intent authorizes each fact type once (per district name for a city's initial districts). */
export function consumeKey(e: Pick<LedgerEvent, 'authorizedBy' | 'type' | 'payload'>): string {
  const key = e.type === 'district.created' ? nameKey(String(e.payload.name)) : '';
  return `${e.authorizedBy}|${e.type}|${key}`;
}
