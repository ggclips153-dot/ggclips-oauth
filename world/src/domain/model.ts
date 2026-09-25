// The world model constants. Names and values follow the World Build Brief verbatim.

export const WORLD_TAG = 'WORLD';

/** City FAMILY field. `essentials` added by Marc (docs/BRIEF-AMENDMENTS.md A1). */
export const FAMILIES = ['revenue', 'claude', 'gemini', 'essentials'] as const;
export type Family = (typeof FAMILIES)[number];

/**
 * In-world economy (brief "In-world economy", A18). Unit: dollars, kept in integer cents.
 * Amounts are set per grant by the Mayor + Marc. Attribution periods are weekly (weeks start Monday).
 */
export const CURRENCY = { name: 'dollars', symbol: '$' } as const;
export const REWARDS = {
  R1: 'Role-scope / cloud-lane expansion (upgrades only)',
  R2: 'City access (never cross-city)',
  R3: 'Dept-lead / mentorship (department needs 3+ agents)',
  R4: 'Tenure / slot security (first-retry grace; never deletion-immunity)',
  R5: 'Hall of Agents (recognition)',
} as const;
export type RewardCode = keyof typeof REWARDS;
/** More than this many QC reworks in a week loses that week's credit. */
export const MAX_QC_REWORKS_PER_PERIOD = 1;

/** Families with a fixed number of cities (A17): Claude and Gemini hold one city each. */
export const MAX_CITIES_PER_FAMILY: Partial<Record<Family, number>> = { claude: 1, gemini: 1 };

/** Mayors of these families READ every city (never edit). Amendment A2. */
export const CROSS_CITY_READ_FAMILIES: readonly Family[] = ['essentials'];

/** The city that runs the jail and records task strikes. Amendments A3, A6. */
export const SECURITY_CITY_ID = 'security-city';

/**
 * Task strikes (caught not doing a task) are a SEPARATE counter from KPI strikes.
 * Every 3 task strikes = a jail term; the counter then resets. Terms escalate and never reset:
 * 6h, 24h, 3 days; the 4th time the agent is jailed awaiting deletion (Marc decides via DM).
 */
export const TASK_STRIKES_PER_JAIL = 3;
export const JAIL_TERMS_HOURS: readonly number[] = [6, 24, 72];

/**
 * Agent states shown in live agent-counts.
 * `enrolled` = intake state: agent created, not yet placed. Placement puts it in school as `student`.
 */
export const AGENT_STATES = ['enrolled', 'student', 'probationer', 'active', 'senior'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** Promotion ladder: student -> probationer -> active -> senior. dept-lead is a badge on senior. */
export const PROMOTION_LADDER: readonly AgentState[] = ['student', 'probationer', 'active', 'senior'];
export const DEPT_LEAD_BADGE = 'dept-lead';
/**
 * Shadow = intern: a student in the last phase before graduation, learning alongside the
 * department's graduated agents. A badge on `student`, counted under student. Amendment A7.
 */
export const INTERN_BADGE = 'intern';
export const DEPT_LEAD_MIN_AGENTS = 3;

/** 3 chances total: miss #1 -> school, miss #2 -> school, miss #3 -> deleted. */
export const MAX_STRIKES = 3;

/** Lifecycle strip stages, in the brief's order. */
export const LIFECYCLE_STAGES = [
  'enrollment',
  'school',
  'graduation',
  'active',
  'promotion',
  'school-return',
  '3rd-strike',
  'deletion',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/**
 * Ledger writer roles.
 * owner     = Marc (via the dashboard). Writes INTENTS only; the DM routes them.
 * dm        = District Messenger. Writes world events and routes intents.
 * mayor     = one per city. Writes its own city's events only.
 * architect = Bob. Cross-city READ only, never writes.
 * gateway   = Hermes' shared-surface gateway. May only ask the surface guard; never reads or writes the ledger.
 */
export const ROLES = ['owner', 'dm', 'mayor', 'architect', 'gateway'] as const;
export type Role = (typeof ROLES)[number];

export const AGENT_STATUSES = ['working', 'idle', 'blocked', 'offline'] as const;
export const KPI_PERIODS = ['week', 'month', '30d'] as const;
