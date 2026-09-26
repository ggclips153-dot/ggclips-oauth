// Event catalog: every event type the world EVENT LEDGER accepts, who may write it, and its payload.
//
// Two kinds of event:
//   intent - Marc's request, written by the dashboard. Changes nothing by itself. The DM routes it.
//   fact   - something that happened, written by a Mayor (its own city) or the DM (world events).
// Facts that place, promote, move or delete an agent, or create structure, must cite an owner
// intent the DM has routed: "mayor + owner executed (via DM)", never self-initiated.
import {
  AGENT_STATUSES,
  FAMILIES,
  KPI_PERIODS,
  type Role,
} from '../domain/model.ts';
import { SHA256_RE, VERSION_RE } from '../domain/constitution.ts';
import type { Schema } from './validate.ts';

export type EventKind = 'fact' | 'intent';
/**
 * world: city tag must be WORLD. city: tag must be an existing city. routed: tag of the intent routed.
 * proposal: an Essentials city's own tag (its Mayor) or WORLD (the DM, for Bob).
 */
export type EventScope = 'world' | 'city' | 'routed' | 'proposal';

export interface EventSpec {
  kind: EventKind;
  writers: readonly Role[];
  scope: EventScope;
  schema: Schema;
  /** Owner intents that may authorize this fact. Absent = no authorization required. */
  authorizedBy?: readonly string[];
  /** Id kind allocated as this event's subject. */
  allocates?: 'CITY' | 'DST' | 'DPT' | 'AGT';
  /** Event acts on an existing entity named by `subject`. */
  subject?: 'agent';
}

const persona: Schema = {
  voice: { t: 'str', max: 500 },
  temperament: { t: 'str', max: 500 },
};

/** New agents are created at the city's college, unplaced (A11). A department then takes an existing agent. */
const agentFields: Schema = {
  name: { t: 'str', max: 80 },
  persona: { t: 'obj', fields: persona },
  domainFocus: { t: 'str', max: 500 },
};

/** Optional department settings (A9). Absent cap = no cap. */
const departmentSettings: Schema = {
  maxGraduated: { t: 'int', min: 0, max: 10000, opt: true },
  maxShadows: { t: 'int', min: 0, max: 10000, opt: true },
  // Approved "basic tasks" graduated agents may hand to the department's shadows.
  basicTasks: { t: 'json', maxBytes: 12000, opt: true },
};

const constitutionFields: Schema = {
  version: { t: 'str', max: 40, re: VERSION_RE, reWhy: 'a version like 1.0.0' },
  docRef: { t: 'str', max: 300 },
  sha256: { t: 'str', max: 64, re: SHA256_RE, reWhy: 'the file\'s SHA-256 fingerprint (64 hex characters)' },
  summary: { t: 'str', max: 4000 },
  proposalSeq: { t: 'int', min: 1, opt: true },
};

const renameDistrict: Schema = {
  districtId: { t: 'str', max: 20 },
  name: { t: 'str', max: 120 },
  supervisor: { t: 'str', max: 120, opt: true },
};
const renameDepartment: Schema = {
  departmentId: { t: 'str', max: 20 },
  name: { t: 'str', max: 120 },
  scope: { t: 'str', max: 2000, opt: true },
};

const departmentFields: Schema = {
  districtId: { t: 'str', max: 20 },
  name: { t: 'str', max: 120 },
  scope: { t: 'str', max: 2000 },
  // Name of the stored secret, never the token itself.
  botTokenRef: { t: 'str', max: 120, opt: true },
  ...departmentSettings,
};

/** Professors are created at the college, optionally specialising in an existing department. */
const professorFields: Schema = {
  ...agentFields,
  departmentId: { t: 'str', max: 20, opt: true },
};

const strikeFields: Schema = {
  reason: { t: 'str', max: 2000 },
  metric: { t: 'str', max: 80 },
  value: { t: 'num' },
  target: { t: 'num' },
};

const OWNER: readonly Role[] = ['owner'];
const DM: readonly Role[] = ['dm'];
const MAYOR: readonly Role[] = ['mayor'];

export const CATALOG: Record<string, EventSpec> = {
  // ---- Intents (Marc via dashboard) ----
  'intent.create_city': {
    kind: 'intent',
    writers: OWNER,
    scope: 'world',
    schema: {
      name: { t: 'str', max: 120 },
      family: { t: 'str', oneOf: FAMILIES },
      mayorName: { t: 'str', max: 80 },
      initialDistricts: { t: 'json', maxBytes: 8000, opt: true },
    },
  },
  'intent.create_district': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { name: { t: 'str', max: 120 }, supervisor: { t: 'str', max: 120 } },
  },
  'intent.create_department': { kind: 'intent', writers: OWNER, scope: 'city', schema: departmentFields },
  // Replaces the department's caps and basic-task list as a whole.
  'intent.configure_department': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { departmentId: { t: 'str', max: 20 }, ...departmentSettings },
  },
  // Rename, or delete, a district or department. Deleting needs it empty (no departments / no agents), so
  // nobody is left without a place; its ID is retired like every other ID.
  'intent.rename_district': { kind: 'intent', writers: OWNER, scope: 'city', schema: renameDistrict },
  'intent.rename_department': { kind: 'intent', writers: OWNER, scope: 'city', schema: renameDepartment },
  'intent.delete_district': { kind: 'intent', writers: OWNER, scope: 'city', schema: { districtId: { t: 'str', max: 20 } } },
  'intent.delete_department': { kind: 'intent', writers: OWNER, scope: 'city', schema: { departmentId: { t: 'str', max: 20 } } },
  // Leave `name` out and the ledger generates one.
  // Retire a senior (tier 5) agent into a professor at the college.
  'intent.retire_to_professor': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { agentId: { t: 'str', max: 20 }, departmentId: { t: 'str', max: 20, opt: true } },
  },
  'intent.specialize_professor': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { professorId: { t: 'str', max: 20 }, departmentId: { t: 'str', max: 20 } },
  },
  // Marc creates the college's dean. Leave `name` out and the ledger generates one.
  'intent.create_dean': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { ...agentFields, name: { t: 'str', max: 80, opt: true } },
  },
  // Replace (or first appoint) the college's dean with an outstanding professor of that college.
  'intent.replace_dean': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { professorId: { t: 'str', max: 20 } },
  },
  'intent.create_professor': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { ...professorFields, name: { t: 'str', max: 80, opt: true } },
  },
  // Leave `name` out and the ledger generates one (see src/domain/names.ts).
  'intent.create_agent': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { ...agentFields, name: { t: 'str', max: 80, opt: true } },
  },
  'intent.place_agent': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { agentId: { t: 'str', max: 20 }, departmentId: { t: 'str', max: 20 } },
  },
  'intent.promote_agent': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: {
      agentId: { t: 'str', max: 20 },
      // Graduation (intern -> probationer) is appointed by the Mayor alone (A8); not an owner intent.
      to: { t: 'str', oneOf: ['active', 'senior', 'dept-lead'] },
    },
  },
  'intent.move_agent': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { agentId: { t: 'str', max: 20 }, toDepartmentId: { t: 'str', max: 20 } },
  },
  'intent.delete_agent': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { agentId: { t: 'str', max: 20 } },
  },
  // Deploy a Security City agent to watch a city. Tagged security-city; Security's Mayor executes.
  // ---- In-world economy (A18): grants are Mayor + Marc executed, never self-run ----
  'intent.grant_earning': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { agentId: { t: 'str', max: 20 }, deliverableSeq: { t: 'int', min: 1 }, amountCents: { t: 'int', min: 1, max: 100_000_000 } },
  },
  'intent.grant_reward': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: {
      agentId: { t: 'str', max: 20 },
      reward: { t: 'str', oneOf: ['R1', 'R2', 'R3', 'R4', 'R5'] },
      amountCents: { t: 'int', min: 0, max: 100_000_000 },
      detail: { t: 'str', max: 1000 },
    },
  },
  'intent.deploy_agent': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { agentId: { t: 'str', max: 20 }, toCity: { t: 'str', max: 60 } },
  },
  // Marc ratifies a version of the World Constitution (Article X), optionally adopting a proposal.
  'intent.amend_constitution': {
    kind: 'intent',
    writers: OWNER,
    scope: 'world',
    schema: constitutionFields,
  },
  'intent.decline_proposal': {
    kind: 'intent',
    writers: OWNER,
    scope: 'world',
    schema: { proposalSeq: { t: 'int', min: 1 }, reason: { t: 'str', max: 2000 } },
  },
  // Marc -> (DM) -> Mayor. The DM relays it to the Mayor's bot.
  'intent.message_mayor': {
    kind: 'intent',
    writers: OWNER,
    scope: 'city',
    schema: { text: { t: 'str', max: 4000 } },
  },

  // ---- DM (world events + routing) ----
  'dm.routed': {
    kind: 'fact',
    writers: DM,
    scope: 'routed',
    schema: { intentSeq: { t: 'int', min: 1 }, to: { t: 'str', max: 120 } },
  },
  'city.created': {
    kind: 'fact',
    writers: DM,
    scope: 'world',
    schema: {
      name: { t: 'str', max: 120 },
      family: { t: 'str', oneOf: FAMILIES },
      mayorName: { t: 'str', max: 80 },
    },
    authorizedBy: ['intent.create_city'],
    allocates: 'CITY',
  },
  'constitution.amended': {
    kind: 'fact',
    writers: DM,
    scope: 'world',
    schema: constitutionFields,
    authorizedBy: ['intent.amend_constitution'],
  },
  'constitution.declined': {
    kind: 'fact',
    writers: DM,
    scope: 'world',
    schema: { proposalSeq: { t: 'int', min: 1 }, reason: { t: 'str', max: 2000 } },
    authorizedBy: ['intent.decline_proposal'],
  },
  // Innovations and Security propose under their own city tag; the DM records Bob's proposals under WORLD
  // (Bob is read-only and never writes). Proposals change nothing: only Marc ratifies.
  'constitution.proposed': {
    kind: 'fact',
    writers: [...MAYOR, ...DM],
    scope: 'proposal',
    schema: {
      proposer: { t: 'str', max: 80 },
      title: { t: 'str', max: 200 },
      rationale: { t: 'str', max: 4000 },
      text: { t: 'str', max: 12000 },
    },
  },
  'world.kpi_rollup': {
    kind: 'fact',
    writers: DM,
    scope: 'world',
    schema: {
      period: { t: 'str', oneOf: KPI_PERIODS },
      periodStart: { t: 'date' },
      rollup: { t: 'json', maxBytes: 32000 },
    },
  },

  // ---- Mayor (own city only) ----
  'district.created': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { name: { t: 'str', max: 120 }, supervisor: { t: 'str', max: 120 } },
    authorizedBy: ['intent.create_district', 'intent.create_city'],
    allocates: 'DST',
  },
  'department.created': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: departmentFields,
    authorizedBy: ['intent.create_department'],
    allocates: 'DPT',
  },
  'department.configured': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { departmentId: { t: 'str', max: 20 }, ...departmentSettings },
    authorizedBy: ['intent.configure_department'],
  },
  'district.renamed': { kind: 'fact', writers: MAYOR, scope: 'city', schema: renameDistrict, authorizedBy: ['intent.rename_district'] },
  'department.renamed': { kind: 'fact', writers: MAYOR, scope: 'city', schema: renameDepartment, authorizedBy: ['intent.rename_department'] },
  'district.deleted': { kind: 'fact', writers: MAYOR, scope: 'city', schema: { districtId: { t: 'str', max: 20 } }, authorizedBy: ['intent.delete_district'] },
  'department.deleted': { kind: 'fact', writers: MAYOR, scope: 'city', schema: { departmentId: { t: 'str', max: 20 } }, authorizedBy: ['intent.delete_department'] },

  // ---- Professors (A10): teach, examine, judge fitness to graduate; may step in for a while ----
  'professor.enrolled': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: professorFields,
    authorizedBy: ['intent.create_professor'],
    allocates: 'AGT',
  },
  // Security applies TEACHING strikes to professors (A13, A15): a deployed Security agent observed a
  // professor (any city) breaking a college teaching rule. Recorded under Security's own tag.
  // Professors take no KPI or task strikes. 3 teaching strikes = held awaiting deletion.
  'professor.strike': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      professorId: { t: 'str', max: 20 },
      observedBy: { t: 'str', max: 20 },
      rule: { t: 'str', max: 300 },
      evidence: { t: 'str', max: 4000 },
      evidenceRef: { t: 'str', max: 300, opt: true },
    },
  },

  // ---- The Dean (A14): one per college, manages the professors; the Mayor judges it ----
  'dean.appointed': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: agentFields,
    authorizedBy: ['intent.create_dean'],
    allocates: 'AGT',
  },
  'dean.replaced': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { professorId: { t: 'str', max: 20 } },
    authorizedBy: ['intent.replace_dean'],
  },
  'dean.reviewed': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      deanId: { t: 'str', max: 20 },
      rating: { t: 'str', oneOf: ['exceeds', 'meets', 'below'] },
      notes: { t: 'str', max: 4000 },
    },
  },
  // The dean saw work not being done and reports the agent to Security (recorded by its Mayor).
  'dean.reported': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      deanId: { t: 'str', max: 20 },
      agentId: { t: 'str', max: 20 },
      reason: { t: 'str', max: 500 },
      evidence: { t: 'str', max: 4000 },
      evidenceRef: { t: 'str', max: 300, opt: true },
    },
  },
  // Security brings a dean's report up to Marc. Marc decides what happens next.
  'security.escalated': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { reportSeq: { t: 'int', min: 1 }, summary: { t: 'str', max: 4000 } },
  },
  'exam.graded': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      professorId: { t: 'str', max: 20 },
      result: { t: 'str', oneOf: ['pass', 'fail'] },
      notes: { t: 'str', max: 4000, opt: true },
      examRef: { t: 'str', max: 300, opt: true },
    },
    subject: 'agent',
  },
  'agent.retired_to_professor': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { departmentId: { t: 'str', max: 20, opt: true } },
    authorizedBy: ['intent.retire_to_professor'],
    subject: 'agent',
  },
  'professor.specialized': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { professorId: { t: 'str', max: 20 }, departmentId: { t: 'str', max: 20 } },
    authorizedBy: ['intent.specialize_professor'],
  },
  // A department reports an unfilled role; the Mayor answers with a professor of that specialty.
  'department.role_requested': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { departmentId: { t: 'str', max: 20 }, role: { t: 'str', max: 300 } },
  },
  'professor.stepped_in': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      professorId: { t: 'str', max: 20 },
      departmentId: { t: 'str', max: 20 },
      role: { t: 'str', max: 300 },
      hours: { t: 'int', min: 1, max: 720 },
      requestSeq: { t: 'int', min: 1, opt: true },
    },
  },

  // ---- Delegation (A9, option B): a logged, narrow exception to "no agent instructs another".
  // A graduated agent hands an approved basic task to a shadow in its own department. The Mayor
  // only RECORDS it; the shadow's output comes back as data for the graduated agent to check.
  'task.delegated': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      fromAgentId: { t: 'str', max: 20 },
      task: { t: 'str', max: 200 },
      details: { t: 'str', max: 2000, opt: true },
    },
    subject: 'agent',
  },
  'task.returned': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      delegationSeq: { t: 'int', min: 1 },
      outcome: { t: 'str', oneOf: ['done', 'not_done'] },
      resultRef: { t: 'str', max: 300, opt: true },
    },
    subject: 'agent',
  },

  // A deliverable, credited to the agent that owns its deciding artifact. Attribution stays in the city.
  'work.deliverable': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      agentId: { t: 'str', max: 20 },
      artifactRef: { t: 'str', max: 300 },
      // Only real-revenue work can ever earn; synthetic work (e.g. paper trading) earns nothing.
      revenue: { t: 'str', oneOf: ['real', 'synthetic'] },
      revenueRef: { t: 'str', max: 300, opt: true },
      revenueCents: { t: 'int', min: 0, max: 1_000_000_000, opt: true },
      periodStart: { t: 'date' },
      description: { t: 'str', max: 2000 },
    },
  },
  'work.qc_rework': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      agentId: { t: 'str', max: 20 },
      artifactRef: { t: 'str', max: 300 },
      periodStart: { t: 'date' },
      reason: { t: 'str', max: 2000 },
    },
  },
  'currency.earned': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { agentId: { t: 'str', max: 20 }, deliverableSeq: { t: 'int', min: 1 }, amountCents: { t: 'int', min: 1, max: 100_000_000 } },
    authorizedBy: ['intent.grant_earning'],
  },
  'currency.spent': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      agentId: { t: 'str', max: 20 },
      reward: { t: 'str', oneOf: ['R1', 'R2', 'R3', 'R4', 'R5'] },
      amountCents: { t: 'int', min: 0, max: 100_000_000 },
      detail: { t: 'str', max: 1000 },
    },
    authorizedBy: ['intent.grant_reward'],
  },

  'agent.enrolled': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: agentFields,
    authorizedBy: ['intent.create_agent'],
    allocates: 'AGT',
  },
  'agent.placed': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { departmentId: { t: 'str', max: 20 } },
    authorizedBy: ['intent.place_agent'],
    subject: 'agent',
  },
  // Shadow promotions are appointed by the Mayor (A8): student -> intern -> graduated (probationer).
  'agent.interned': { kind: 'fact', writers: MAYOR, scope: 'city', schema: {}, subject: 'agent' },
  'agent.graduated': { kind: 'fact', writers: MAYOR, scope: 'city', schema: {}, subject: 'agent' },
  'agent.promoted': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { to: { t: 'str', oneOf: ['active', 'senior'] } },
    authorizedBy: ['intent.promote_agent'],
    subject: 'agent',
  },
  'agent.lead_assigned': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {},
    authorizedBy: ['intent.promote_agent'],
    subject: 'agent',
  },
  'agent.moved': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { toDepartmentId: { t: 'str', max: 20 } },
    authorizedBy: ['intent.move_agent'],
    subject: 'agent',
  },
  'agent.school_returned': { kind: 'fact', writers: MAYOR, scope: 'city', schema: strikeFields, subject: 'agent' },
  'agent.third_strike': { kind: 'fact', writers: MAYOR, scope: 'city', schema: strikeFields, subject: 'agent' },
  'agent.deleted': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      // Full ledger is FROZEN + ARCHIVED; only the distilled lesson record feeds the replacement.
      ledgerArchiveRef: { t: 'str', max: 300 },
      lessonRecordRef: { t: 'str', max: 300 },
    },
    authorizedBy: ['intent.delete_agent'],
    subject: 'agent',
  },
  'agent.deployed': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: { toCity: { t: 'str', max: 60 } },
    authorizedBy: ['intent.deploy_agent'],
    subject: 'agent',
  },
  // A deployed Security agent caught an agent (any city) not doing a task. Security's Mayor records
  // it under Security's OWN city tag. Every 3rd task strike jails the agent automatically.
  'security.task_strike': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      agentId: { t: 'str', max: 20 },
      observedBy: { t: 'str', max: 20 },
      task: { t: 'str', max: 500 },
      evidence: { t: 'str', max: 4000 },
      evidenceRef: { t: 'str', max: 300, opt: true },
    },
  },
  'agent.status': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      status: { t: 'str', oneOf: AGENT_STATUSES },
      activity: { t: 'str', max: 280, opt: true },
    },
    subject: 'agent',
  },
  'city.kpi_pulse': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      metric: { t: 'str', max: 80 },
      value: { t: 'num', min: 0 },
      target: { t: 'num', min: 0, opt: true },
      period: { t: 'str', oneOf: KPI_PERIODS },
      periodStart: { t: 'date' },
      secondaryMetric: { t: 'str', max: 80, opt: true },
      secondaryValue: { t: 'num', opt: true },
    },
  },
  'city.health_report': {
    kind: 'fact',
    writers: MAYOR,
    scope: 'city',
    schema: {
      weekOf: { t: 'date' },
      summary: { t: 'str', max: 8000 },
      ref: { t: 'str', max: 300, opt: true },
    },
  },
};

export const specFor = (type: string): EventSpec | undefined =>
  Object.hasOwn(CATALOG, type) ? CATALOG[type] : undefined;
