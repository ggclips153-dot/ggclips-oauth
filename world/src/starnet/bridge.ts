// Agents run on StarNet (A20): when Marc messages an agent whose city has a running station, the station runs
// the agent's turn (real model call, tools, cost) and its answer is recorded in the ledger as `agent.said`,
// written by the station on the city's behalf. Without a running station the city's Mayor bot answers, as before.
import type { Agent, LedgerEvent } from '../domain/state.ts';
import type { Profile } from '../ledger/guard.ts';
import type { Ledger } from '../ledger/ledger.ts';
import type { Stations } from './stations.ts';

export interface StationAsker {
  isUp(cityId: string): boolean;
  ask: Stations['ask'];
}

/** Who the agent is, for the station: name, place in the world, focus and persona. */
export function agentBrief(ledger: Ledger, a: Agent): string {
  const st = ledger.state;
  const city = st.cities.get(a.cityId);
  const dept = a.departmentId ? st.departments.get(a.departmentId) : null;
  const district = dept ? st.districts.get(dept.districtId) : null;
  const where =
    a.role === 'dean' ? 'the dean of the city college'
      : a.role === 'professor' ? 'a professor at the city college'
        : dept ? `a ${a.state} agent in the ${dept.name} department (${district?.name ?? 'district'}): ${dept.scope}`
          : 'a new agent at the city college, waiting for a department';
  const { persona, domainFocus: focus } = a;
  return [
    `You are ${a.name} (${a.id}), ${where}, in ${city?.name ?? a.cityId}, one of the AI-agent cities of Marc's world.`,
    focus ? `Your focus: ${focus}.` : '',
    persona ? `Voice: ${persona.voice}. Temperament: ${persona.temperament}.` : '',
    'Marc owns the world and is talking to you directly. Answer as yourself, briefly and concretely. Never claim work you have not done.',
  ].filter(Boolean).join(' ');
}

export interface Bridge {
  /** Cities whose conversations the stations handle (the demo stand-in stays out of those). */
  handles(cityId: string): boolean;
  /** The last error per agent, shown in the conversation. */
  errors(): Record<string, { seq: number; message: string; at: string }>;
  /** Agents whose answer is being worked on right now. */
  working(): string[];
  stop(): void;
}

export function attachStarnetBridge(ledger: Ledger, stations: StationAsker, { log = (m: string) => console.log(m), onChange = () => {} } = {}): Bridge {
  const errors: Record<string, { seq: number; message: string; at: string }> = {};
  const busy = new Set<string>();
  const onEvent = (e: LedgerEvent) => {
    if (e.type !== 'intent.message_agent' || !stations.isUp(e.city)) return;
    const p = e.payload as { agentId: string; text: string };
    const a = ledger.state.agents.get(p.agentId);
    if (!a || a.deleted) return;
    const by: Profile = { id: `starnet-${e.city}`, role: 'mayor', writeScope: [e.city] };
    busy.add(a.id);
    onChange();
    stations
      .ask(e.city, a.id, agentBrief(ledger, a), p.text)
      .then((answer) => {
        ledger.append(by, { type: 'agent.said', city: e.city, subject: a.id, payload: { text: answer.slice(0, 8000), replyTo: e.seq } });
        delete errors[a.id];
      })
      .catch((err: Error) => {
        errors[a.id] = { seq: e.seq, message: err.message, at: new Date().toISOString() };
        log(`StarNet: ${a.id} in ${e.city} could not answer message #${e.seq}: ${err.message}`);
      })
      .finally(() => {
        busy.delete(a.id);
        onChange(); // wake the dashboards: the answer, or the error, shows in the conversation
      });
  };
  ledger.events.on('event', onEvent);
  return {
    handles: (cityId) => stations.isUp(cityId),
    errors: () => ({ ...errors }),
    working: () => [...busy],
    stop: () => ledger.events.off('event', onEvent),
  };
}
