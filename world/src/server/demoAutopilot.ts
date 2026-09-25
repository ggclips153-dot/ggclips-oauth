// DEMO ONLY. Plays the DM and the Mayors for data/demo.db so Marc can try the dashboard's forms
// before the real Telegram bots are connected. Every write goes through the same write-guard as the
// real bots (DM routes the intent, the Mayor executes the fact), so rejected requests stay rejected.
// It refuses to attach to any ledger file not named demo.db: the real world is never auto-executed.
import { basename } from 'node:path';
import type { LedgerEvent } from '../domain/state.ts';
import type { AppendInput, Profile } from '../ledger/guard.ts';
import type { Ledger } from '../ledger/ledger.ts';

const DM: Profile = { id: 'dm-demo', role: 'dm', writeScope: ['*'] };
const mayor = (city: string): Profile => ({ id: `mayor-demo-${city}`, role: 'mayor', writeScope: [city] });

/** The fact(s) a Mayor (or the DM) writes to carry out an intent. */
function facts(ledger: Ledger, i: LedgerEvent): [Profile, AppendInput][] {
  const p = i.payload as Record<string, any>;
  const c = i.city;
  const m = mayor(c);
  const by = (type: string, payload: unknown, subject?: string): [Profile, AppendInput] => [
    m,
    { type, city: c, subject: subject ?? null, payload, authorizedBy: i.seq },
  ];
  switch (i.type) {
    case 'intent.create_city': {
      const created: [Profile, AppendInput] = [DM, { type: 'city.created', city: 'WORLD', payload: { name: p.name, family: p.family, mayorName: p.mayorName }, authorizedBy: i.seq }];
      return [created];
    }
    case 'intent.create_district':
      return [by('district.created', p)];
    case 'intent.create_department':
      return [by('department.created', p)];
    case 'intent.configure_department':
      return [by('department.configured', p)];
    case 'intent.create_agent':
      return [by('agent.enrolled', p)];
    case 'intent.place_agent':
      return [by('agent.placed', { departmentId: p.departmentId }, p.agentId)];
    case 'intent.promote_agent':
      return [p.to === 'dept-lead' ? by('agent.lead_assigned', {}, p.agentId) : by('agent.promoted', { to: p.to }, p.agentId)];
    case 'intent.move_agent':
      return [by('agent.moved', { toDepartmentId: p.toDepartmentId }, p.agentId)];
    case 'intent.delete_agent':
      return [by('agent.deleted', { ledgerArchiveRef: `archive/${p.agentId}/ledger`, lessonRecordRef: `lessons/${p.agentId}.md` }, p.agentId)];
    case 'intent.create_professor':
      return [by('professor.enrolled', p)];
    case 'intent.specialize_professor':
      return [by('professor.specialized', p)];
    case 'intent.create_dean':
      return [by('dean.appointed', p)];
    case 'intent.replace_dean':
      return [by('dean.replaced', p)];
    case 'intent.retire_to_professor':
      return [by('agent.retired_to_professor', p.departmentId ? { departmentId: p.departmentId } : {}, p.agentId)];
    case 'intent.grant_earning':
      return [by('currency.earned', p)];
    case 'intent.grant_reward':
      return [by('currency.spent', p)];
    case 'intent.deploy_agent':
      return [by('agent.deployed', { toCity: p.toCity }, p.agentId)];
    case 'intent.amend_constitution':
      return [[DM, { type: 'constitution.amended', city: 'WORLD', payload: p, authorizedBy: i.seq }]];
    case 'intent.decline_proposal':
      return [[DM, { type: 'constitution.declined', city: 'WORLD', payload: p, authorizedBy: i.seq }]];
    default:
      return []; // e.g. message_mayor: routed only
  }
}

/** After a city is created, its Mayor sets up the initial districts it was created with. */
function followUps(ledger: Ledger, fact: LedgerEvent, intent: LedgerEvent): [Profile, AppendInput][] {
  if (fact.type !== 'city.created') return [];
  const list = ((intent.payload as Record<string, any>).initialDistricts ?? []) as { name: string; supervisor: string }[];
  return list.map((d) => [mayor(fact.subject!), { type: 'district.created', city: fact.subject!, payload: d, authorizedBy: intent.seq }]);
}

export function attachDemoAutopilot(ledger: Ledger, dbPath: string, log = (m: string) => console.log(m)): () => void {
  if (basename(dbPath) !== 'demo.db') throw new Error('the demo autopilot only runs on data/demo.db, never on the real ledger');
  const onEvent = (e: LedgerEvent) => {
    if (e.kind !== 'intent') return;
    // Run after the current append has finished.
    setImmediate(() => {
      try {
        ledger.append(DM, { type: 'dm.routed', city: e.city, payload: { intentSeq: e.seq, to: e.city === 'WORLD' ? 'world' : `mayor:${e.city}` } });
        for (const [who, input] of facts(ledger, e)) {
          const fact = ledger.append(who, input);
          for (const [who2, next] of followUps(ledger, fact, e)) ledger.append(who2, next);
        }
      } catch (err) {
        log(`demo autopilot: intent #${e.seq} (${e.type}) not carried out: ${(err as Error).message}`);
      }
    });
  };
  ledger.events.on('event', onEvent);
  log('DEMO AUTOPILOT ON: acting as the DM and every Mayor for demo.db');
  return () => ledger.events.off('event', onEvent);
}
