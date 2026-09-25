import { Ledger } from '../src/ledger/ledger.ts';
import type { AppendInput, Profile } from '../src/ledger/guard.ts';
import type { LedgerEvent } from '../src/domain/state.ts';

export const owner: Profile = { id: 'marc', role: 'owner', writeScope: ['*'] };
export const dm: Profile = { id: 'dm', role: 'dm', writeScope: ['*'] };
export const bob: Profile = { id: 'bob', role: 'architect', writeScope: [] };
export const mayorOf = (city: string): Profile => ({ id: `mayor-${city}`, role: 'mayor', writeScope: [city] });

export const persona = { voice: 'warm, concise', temperament: 'patient' };

/** A world with helpers that follow the real path: Marc intent -> DM routes -> Mayor/DM fact. */
export class TestWorld {
  readonly ledger: Ledger;
  /** Controllable clock: advance with `w.advanceHours(n)`. */
  time = new Date('2026-09-25T12:00:00Z');

  constructor(path = ':memory:') {
    this.ledger = new Ledger({ path, now: () => this.time });
  }

  advanceHours(h: number) {
    this.time = new Date(this.time.getTime() + h * 3_600_000);
  }

  get state() {
    return this.ledger.state;
  }

  intent(type: string, city: string, payload: unknown): LedgerEvent {
    const e = this.ledger.append(owner, { type: `intent.${type}`, city, payload });
    this.ledger.append(dm, { type: 'dm.routed', city, payload: { intentSeq: e.seq, to: `mayor:${city}` } });
    return e;
  }

  fact(by: Profile, input: AppendInput): LedgerEvent {
    return this.ledger.append(by, input);
  }

  city(name = 'AI Receptionist City', family = 'revenue', initialDistricts?: unknown[]): string {
    const i = this.intent('create_city', 'WORLD', { name, family, mayorName: 'Mayor Ada', ...(initialDistricts ? { initialDistricts } : {}) });
    return this.fact(dm, { type: 'city.created', city: 'WORLD', payload: { name, family, mayorName: 'Mayor Ada' }, authorizedBy: i.seq }).subject!;
  }

  district(city: string, name = 'Front Desk'): string {
    const payload = { name, supervisor: 'Sup One' };
    const i = this.intent('create_district', city, payload);
    return this.fact(mayorOf(city), { type: 'district.created', city, payload, authorizedBy: i.seq }).subject!;
  }

  department(city: string, districtId: string, slots = 3): string {
    const payload = { districtId, name: 'Booking', scope: 'Book qualified appointments', slots };
    const i = this.intent('create_department', city, payload);
    return this.fact(mayorOf(city), { type: 'department.created', city, payload, authorizedBy: i.seq }).subject!;
  }

  /** Enroll + place: returns an agent in school (student). */
  agent(city: string, departmentId: string, name: string): string {
    const payload = { name, persona, domainFocus: 'dental bookings', departmentId };
    const i = this.intent('create_agent', city, payload);
    const id = this.fact(mayorOf(city), { type: 'agent.enrolled', city, payload, authorizedBy: i.seq }).subject!;
    this.fact(mayorOf(city), { type: 'agent.placed', city, subject: id, payload: { departmentId }, authorizedBy: i.seq });
    return id;
  }

  promote(city: string, agentId: string, to: 'probationer' | 'active' | 'senior' | 'dept-lead') {
    const i = this.intent('promote_agent', city, { agentId, to });
    const type = to === 'probationer' ? 'agent.graduated' : to === 'dept-lead' ? 'agent.lead_assigned' : 'agent.promoted';
    const payload = type === 'agent.promoted' ? { to } : {};
    return this.fact(mayorOf(city), { type, city, subject: agentId, payload, authorizedBy: i.seq });
  }

  miss(city: string, agentId: string, third = false) {
    return this.fact(mayorOf(city), {
      type: third ? 'agent.third_strike' : 'agent.school_returned',
      city,
      subject: agentId,
      payload: { reason: 'missed qualified bookings target', metric: 'qualified_bookings', value: 2, target: 10 },
    });
  }
}
