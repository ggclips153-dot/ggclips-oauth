// Read-side: what each profile may see, and the dashboard's view of the projection.
// Marc, the DM and Bob read across cities. Mayors of Essentials cities (Innovations, Security)
// also read every city but still write only their own. Any other Mayor reads only its own city.
import { CROSS_CITY_READ_FAMILIES } from './model.ts';
import type { Profile } from '../ledger/guard.ts';
import { isJailed, type Agent, type LedgerEvent, type WorldState } from './state.ts';

export function readScope(profile: Profile, state: WorldState): '*' | string {
  if (profile.role !== 'mayor') return '*';
  const own = profile.writeScope[0]!;
  const family = state.cities.get(own)?.family;
  return family && CROSS_CITY_READ_FAMILIES.includes(family) ? '*' : own;
}

export function canRead(profile: Profile, e: LedgerEvent, state: WorldState): boolean {
  const scope = readScope(profile, state);
  if (scope === '*' || e.city === scope) return true;
  if (e.type === 'city.created') return e.subject === scope;
  // A Mayor sees Security's strikes and escalations about its own city, though Security records them.
  if (e.type === 'security.task_strike') return state.agents.get(String(e.payload.agentId))?.cityId === scope;
  if (e.type === 'professor.strike') return state.agents.get(String(e.payload.professorId))?.cityId === scope;
  if (e.type === 'security.escalated') return state.deanReports.get(Number(e.payload.reportSeq))?.cityId === scope;
  return false;
}

const agentView = (a: Agent) => ({
  id: a.id,
  name: a.name,
  departmentId: a.departmentId,
  state: a.state,
  badges: a.badges,
  graduated: a.graduated,
  strikes: a.strikes,
  persona: a.persona,
  domainFocus: a.domainFocus,
  ledgerPointer: a.ledgerPointer,
  memoryScope: a.memoryScope,
  status: a.status,
  lifecycle: a.lifecycle,
  taskStrikes: a.taskStrikes,
  jailTerms: a.jailTerms,
  jail: a.jail,
  deployedTo: a.deployedTo,
  lastExam: a.lastExam,
});

const professorView = (a: Agent, now: Date) => ({
  ...agentView(a),
  specialtyDepartmentId: a.specialtyDepartmentId,
  professorSince: a.professorSince,
  teaching: a.teaching,
  steppedIn: a.steppedIn && Date.parse(a.steppedIn.until) > now.getTime() ? a.steppedIn : null,
});

/** The dean is judged on how its college's graduates perform in their fields (A14). */
function deanView(state: WorldState, dean: Agent, now: Date) {
  const grads = dean.dean!.graduates.map((id) => state.agents.get(id)!).filter(Boolean);
  return {
    ...agentView(dean),
    since: dean.dean!.since,
    reviews: dean.dean!.reviews,
    scorecard: {
      graduates: grads.length,
      stillWorking: grads.filter((a) => !a.deleted && a.role === 'agent' && ['probationer', 'active', 'senior'].includes(a.state)).length,
      promotedPastProbation: grads.filter((a) => !a.deleted && (a.role !== 'agent' || ['active', 'senior'].includes(a.state))).length,
      kpiStrikes: grads.reduce((n, a) => n + a.strikes, 0),
      jailTerms: grads.reduce((n, a) => n + a.jailTerms, 0),
      inJailNow: grads.filter((a) => isJailed(a, now)).length,
      deleted: grads.filter((a) => a.deleted).length,
    },
  };
}

export function worldView(state: WorldState, profile: Profile, now: Date) {
  const scope = readScope(profile, state);
  const agents = [...state.agents.values()];
  const cities = [...state.cities.values()]
    .filter((c) => scope === '*' || c.id === scope)
    .map((c) => {
      const living = agents.filter((a) => a.cityId === c.id && !a.deleted);
      return {
        ...c,
        agentCounts: state.cityAgentCounts(c.id),
        jailedCount: living.filter((a) => isJailed(a, now)).length,
        districts: [...state.districts.values()]
          .filter((d) => d.cityId === c.id)
          .map((d) => ({
            ...d,
            departments: [...state.departments.values()]
              .filter((dp) => dp.districtId === d.id)
              .map((dp) => ({
                ...dp,
                graduatedCount: state.graduatedIn(dp.id).length,
                shadowCount: state.shadowsIn(dp.id).length,
                agents: living.filter((a) => a.departmentId === dp.id).map(agentView),
                // Professors of this specialty at the college; `steppedIn` shows who is filling a role here now.
                professors: state.professors(c.id).filter((pr) => pr.specialtyDepartmentId === dp.id).map((pr) => professorView(pr, now)),
                openRoleRequests: [...state.roleRequests.values()].filter((r) => r.departmentId === dp.id && !r.filledBy),
                openDelegations: [...state.delegations.values()].filter((dl) => dl.departmentId === dp.id && !dl.returned),
              })),
          })),
        // The city's college: where agents and professors are created. New agents wait here, unplaced,
        // until a department takes them.
        college: {
          dean: (() => {
            const dean = state.deanOf(c.id);
            return dean ? deanView(state, dean, now) : null;
          })(),
          enrolled: living.filter((a) => a.role === 'agent' && a.state === 'enrolled').map(agentView),
          professors: state.professors(c.id).map((pr) => professorView(pr, now)),
        },
        deanReports: [...state.deanReports.values()].filter((r) => r.cityId === c.id),
        retired: agents
          .filter((a) => a.cityId === c.id && a.deleted)
          .map((a) => ({ id: a.id, name: a.name, deleted: a.deleted, lifecycle: a.lifecycle })),
      };
    });

  const pendingIntents = [...state.intents.values()]
    .filter((i) => !state.routed.has(i.seq) && (scope === '*' || i.city === scope))
    .map((i) => ({ seq: i.seq, ts: i.ts, type: i.type, city: i.city, payload: i.payload }));

  // Security's jail: every jailed agent the reader can see, from any city.
  // Timed terms drop off on their own once `until` passes.
  const jail = agents
    .filter((a) => isJailed(a, now) && (scope === '*' || a.cityId === scope))
    .map((a) => ({ id: a.id, name: a.name, cityId: a.cityId, state: a.state, strikes: a.strikes, jailTerms: a.jailTerms, jail: a.jail }));
  const taskStrikes = state.taskStrikes.filter((t) => scope === '*' || t.agentCity === scope);
  // Dean reports Security has brought up to Marc: his inbox.
  const escalations = [...state.deanReports.values()].filter((r) => r.escalated && (scope === '*' || r.cityId === scope));

  return {
    lastSeq: state.lastSeq,
    now: now.toISOString(),
    jail,
    taskStrikes,
    escalations,
    constitution: state.constitution,
    worldRollup: scope === '*' ? state.worldRollup : null,
    cities,
    pendingIntents,
  };
}
