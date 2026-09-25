// The world model constants. Names and values follow the World Build Brief verbatim.

export const WORLD_TAG = 'WORLD';

/** City FAMILY field. `essentials` added by Marc (docs/BRIEF-AMENDMENTS.md A1). */
export const FAMILIES = ['revenue', 'claude', 'gemini', 'essentials'] as const;
export type Family = (typeof FAMILIES)[number];

/** Mayors of these families READ every city (never edit). Amendment A2. */
export const CROSS_CITY_READ_FAMILIES: readonly Family[] = ['essentials'];

/** The city that runs the jail and files security flags. Amendment A3. */
export const SECURITY_CITY_ID = 'security-city';
export const JAIL_REASONS = ['not_doing_tasks'] as const;

/**
 * Agent states shown in live agent-counts.
 * `enrolled` = intake state: agent created, not yet placed. Placement puts it in school as `student`.
 */
export const AGENT_STATES = ['enrolled', 'student', 'probationer', 'active', 'senior'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** Promotion ladder: student -> probationer -> active -> senior. dept-lead is a badge on senior. */
export const PROMOTION_LADDER: readonly AgentState[] = ['student', 'probationer', 'active', 'senior'];
export const DEPT_LEAD_BADGE = 'dept-lead';
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
 */
export const ROLES = ['owner', 'dm', 'mayor', 'architect'] as const;
export type Role = (typeof ROLES)[number];

export const AGENT_STATUSES = ['working', 'idle', 'blocked', 'offline'] as const;
export const KPI_PERIODS = ['week', 'month', '30d'] as const;
