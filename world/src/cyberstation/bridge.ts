// CyberStation (A31): an agent linked to its own Hermes profile answers Marc itself. Its turn runs on that profile
// (its own persona, tools and memory), and the answer is recorded in the ledger as `agent.said`, written on the
// city's behalf. An agent that isn't linked yet, or whose profile has no key on this PC, is answered as before (a
// StarNet station or the Mayor's bot).
import type { LedgerEvent } from '../domain/state.ts';
import type { Profile } from '../ledger/guard.ts';
import type { Ledger } from '../ledger/ledger.ts';
import type { HermesLink } from './hermes.ts';

export interface CyberStationBridge {
  /** This agent answers through CyberStation: it is linked to a Hermes profile with a key on this PC. */
  handlesAgent(agentId: string): boolean;
  /** The last error per agent, shown in the conversation. */
  errors(): Record<string, { seq: number; message: string; at: string }>;
  /** Agents whose answer is being worked on right now. */
  working(): string[];
  stop(): void;
}

export function attachCyberStation(ledger: Ledger, link: Pick<HermesLink, 'canReach' | 'ask'>, { log = (m: string) => console.log(m), onChange = () => {} } = {}): CyberStationBridge {
  const errors: Record<string, { seq: number; message: string; at: string }> = {};
  const busy = new Set<string>();
  const handlesAgent = (agentId: string) => {
    const a = ledger.state.agents.get(agentId);
    return !!a && !a.deleted && link.canReach(a.hermesProfile);
  };
  const onEvent = (e: LedgerEvent) => {
    if (e.type !== 'intent.message_agent') return;
    const p = e.payload as { agentId: string; text: string };
    if (!handlesAgent(p.agentId)) return;
    const a = ledger.state.agents.get(p.agentId)!;
    const profile = a.hermesProfile!;
    const by: Profile = { id: `cyberstation-${e.city}`, role: 'mayor', writeScope: [e.city] };
    busy.add(a.id);
    onChange();
    link
      .ask(profile, a.id, p.text)
      .then((answer) => {
        ledger.append(by, { type: 'agent.said', city: e.city, subject: a.id, payload: { text: answer.slice(0, 8000), replyTo: e.seq } });
        delete errors[a.id];
      })
      .catch((err: Error) => {
        errors[a.id] = { seq: e.seq, message: err.message, at: new Date().toISOString() };
        log(`CyberStation: ${a.id} (Hermes profile ${profile}) could not answer message #${e.seq}: ${err.message}`);
      })
      .finally(() => {
        busy.delete(a.id);
        onChange(); // wake the dashboards: the answer, or the error, shows in the conversation
      });
  };
  ledger.events.on('event', onEvent);
  return {
    handlesAgent,
    errors: () => ({ ...errors }),
    working: () => [...busy],
    stop: () => ledger.events.off('event', onEvent),
  };
}
