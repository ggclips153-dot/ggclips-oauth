// Read-side: what each profile may see, and the dashboard's view of the projection.
// Marc, the DM and Bob read across cities. Mayors of Essentials cities (Innovations, Security)
// also read every city but still write only their own. Any other Mayor reads only its own city.
import { CROSS_CITY_READ_FAMILIES } from './model.ts';
import type { Profile } from '../ledger/guard.ts';
import type { Agent, LedgerEvent, WorldState } from './state.ts';

export function readScope(profile: Profile, state: WorldState): '*' | string {
  if (profile.role !== 'mayor') return '*';
  const own = profile.writeScope[0]!;
  const family = state.cities.get(own)?.family;
  return family && CROSS_CITY_READ_FAMILIES.includes(family) ? '*' : own;
}

export function canRead(profile: Profile, e: LedgerEvent, state: WorldState): boolean {
  const scope = readScope(profile, state);
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
  jail: a.jail,
});

export function worldView(state: WorldState, profile: Profile) {
  const scope = readScope(profile, state);
  const agents = [...state.agents.values()];
  const cities = [...state.cities.values()]
    .filter((c) => scope === '*' || c.id === scope)
    .map((c) => {
      const living = agents.filter((a) => a.cityId === c.id && !a.deleted);
      return {
        ...c,
        agentCounts: state.cityAgentCounts(c.id),
        jailedCount: living.filter((a) => a.jail).length,
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

  // Security's jail: every jailed agent the reader can see, from any city.
  const jail = agents
    .filter((a) => a.jail && !a.deleted && (scope === '*' || a.cityId === scope))
    .map((a) => ({ id: a.id, name: a.name, cityId: a.cityId, state: a.state, strikes: a.strikes, jail: a.jail }));
  const securityFlags = state.securityFlags.filter((f) => scope === '*' || f.agentCity === scope);

  return {
    lastSeq: state.lastSeq,
    jail,
    securityFlags,
    constitution: state.constitution,
    worldRollup: scope === '*' ? state.worldRollup : null,
    cities,
    pendingIntents,
  };
}
