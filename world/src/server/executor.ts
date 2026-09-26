// Carrying out an intent: the DM routes it, then the Mayor (or the DM, for world events) writes the facts.
// Used by the demo autopilot, and by Marc's "Carry out" button when he acts as DM and Mayor himself.
// Every write still goes through the write-guard, so whatever the bots could not do, this cannot either.
import type { LedgerEvent } from '../domain/state.ts';
import type { AppendInput, Profile } from '../ledger/guard.ts';
import type { Ledger } from '../ledger/ledger.ts';

export interface Actors {
  dm: Profile;
  mayor: (city: string) => Profile;
}

/** The fact(s) a Mayor (or the DM) writes to carry out an intent. */
function facts(i: LedgerEvent, { dm: DM, mayor }: Actors): [Profile, AppendInput][] {
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
function followUps(fact: LedgerEvent, intent: LedgerEvent, { mayor }: Actors): [Profile, AppendInput][] {
  if (fact.type !== 'city.created') return [];
  const list = ((intent.payload as Record<string, any>).initialDistricts ?? []) as { name: string; supervisor: string }[];
  return list.map((d) => [mayor(fact.subject!), { type: 'district.created', city: fact.subject!, payload: d, authorizedBy: intent.seq }]);
}


/** Route the intent (unless already routed) and write the facts that carry it out. Returns what was written. */
export function carryOut(ledger: Ledger, intent: LedgerEvent, actors: Actors, to?: string): LedgerEvent[] {
  const written: LedgerEvent[] = [];
  if (!ledger.state.routed.has(intent.seq)) {
    written.push(ledger.append(actors.dm, {
      type: 'dm.routed',
      city: intent.city,
      payload: { intentSeq: intent.seq, to: to ?? (intent.city === 'WORLD' ? 'world' : `mayor:${intent.city}`) },
    }));
  }
  for (const [who, input] of facts(intent, actors)) {
    const fact = ledger.append(who, input);
    written.push(fact);
    for (const [who2, next] of followUps(fact, intent, actors)) written.push(ledger.append(who2, next));
  }
  return written;
}
