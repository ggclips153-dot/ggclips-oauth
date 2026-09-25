// Read-side: what each profile may see, and the dashboard's view of the projection.
// Marc, the DM and Bob read across cities. A Mayor reads only its own city.
import type { Profile } from '../ledger/guard.ts';
import type { Agent, LedgerEvent, WorldState } from './state.ts';

export function readScope(profile: Profile): '*' | string {
  return profile.role === 'mayor' ? profile.writeScope[0]! : '*';
}

export function canRead(profile: Profile, e: LedgerEvent): boolean {
  const scope = readScope(profile);
  return scope === '*' || e.city === scope || (e.type === 'city.created' && e.subject === scope);
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
});

export function worldView(state: WorldState, profile: Profile) {
  const scope = readScope(profile);
  const agents = [...state.agents.values()];
  const cities = [...state.cities.values()]
    .filter((c) => scope === '*' || c.id === scope)
    .map((c) => {
      const living = agents.filter((a) => a.cityId === c.id && !a.deleted);
      return {
        ...c,
        agentCounts: state.cityAgentCounts(c.id),
        districts: [...state.districts.values()]
          .filter((d) => d.cityId === c.id)
          .map((d) => ({
            ...d,
            departments: [...state.departments.values()]
              .filter((dp) => dp.districtId === d.id)
              .map((dp) => ({ ...dp, agents: living.filter((a) => a.departmentId === dp.id).map(agentView) })),
          })),
        enrolled: living.filter((a) => a.state === 'enrolled').map(agentView),
        retired: agents
          .filter((a) => a.cityId === c.id && a.deleted)
          .map((a) => ({ id: a.id, name: a.name, deleted: a.deleted, lifecycle: a.lifecycle })),
      };
    });

  const pendingIntents = [...state.intents.values()]
    .filter((i) => !state.routed.has(i.seq) && (scope === '*' || i.city === scope))
    .map((i) => ({ seq: i.seq, ts: i.ts, type: i.type, city: i.city, payload: i.payload }));

  return {
    lastSeq: state.lastSeq,
    constitution: state.constitution,
    worldRollup: scope === '*' ? state.worldRollup : null,
    cities,
    pendingIntents,
  };
}
