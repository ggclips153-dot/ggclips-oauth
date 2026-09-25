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

  department(city: string, districtId: string): string {
    const payload = { districtId, name: 'Booking', scope: 'Book qualified appointments' };
    const i = this.intent('create_department', city, payload);
    return this.fact(mayorOf(city), { type: 'department.created', city, payload, authorizedBy: i.seq }).subject!;
  }

  /** Create a beginner agent at the city's college: enrolled, unplaced. */
  collegeAgent(city: string, name?: string): string {
    const i = this.intent('create_agent', city, { ...(name ? { name } : {}), persona, domainFocus: 'dental bookings' });
    return this.fact(mayorOf(city), { type: 'agent.enrolled', city, payload: i.payload, authorizedBy: i.seq }).subject!;
  }

  /** A department takes an EXISTING agent from the college: it becomes a student there. */
  place(city: string, agentId: string, departmentId: string) {
    const i = this.intent('place_agent', city, { agentId, departmentId });
    return this.fact(mayorOf(city), { type: 'agent.placed', city, subject: agentId, payload: { departmentId }, authorizedBy: i.seq });
  }

  /** College + placement: returns an agent in school (student) in the department. */
  agent(city: string, departmentId: string, name: string): string {
    const id = this.collegeAgent(city, name);
    this.place(city, id, departmentId);
    return id;
  }

  /** A professor for the department (created once, name generated). */
  professor(city: string, departmentId: string): string {
    const existing = this.state.professors().find((p) => p.specialtyDepartmentId === departmentId);
    if (existing) return existing.id;
    const i = this.intent('create_professor', city, { persona, domainFocus: 'teaching', departmentId });
    return this.fact(mayorOf(city), { type: 'professor.enrolled', city, payload: i.payload, authorizedBy: i.seq }).subject!;
  }

  exam(city: string, agentId: string, result: 'pass' | 'fail' = 'pass') {
    const professorId = this.professor(city, this.state.agents.get(agentId)!.departmentId!);
    return this.fact(mayorOf(city), { type: 'exam.graded', city, subject: agentId, payload: { professorId, result } });
  }

  /** 'probationer' = graduation, appointed by the Mayor alone: intern (shadow) + passed exam -> graduated. */
  promote(city: string, agentId: string, to: 'probationer' | 'active' | 'senior' | 'dept-lead') {
    if (to === 'probationer') {
      const mayor = mayorOf(city);
      if (!this.state.agents.get(agentId)!.badges.includes('intern')) {
        this.fact(mayor, { type: 'agent.interned', city, subject: agentId, payload: {} });
      }
      this.exam(city, agentId);
      return this.fact(mayor, { type: 'agent.graduated', city, subject: agentId, payload: {} });
    }
    const i = this.intent('promote_agent', city, { agentId, to });
    const type = to === 'dept-lead' ? 'agent.lead_assigned' : 'agent.promoted';
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
