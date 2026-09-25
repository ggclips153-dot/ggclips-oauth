// Build a DEMO world in data/demo.db so the dashboard can be tried safely. Never touches the real
// ledger (data/world.db). Every event goes through the real path: Marc intent -> DM routes -> fact.
//   npm run demo
//   WORLD_DB=data/demo.db npm start
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AppendInput, Profile } from '../src/ledger/guard.ts';
import { Ledger } from '../src/ledger/ledger.ts';
import { CONSTITUTION_DOC_REF, readConstitution } from '../src/domain/constitution.ts';

const path = resolve(import.meta.dirname, '..', process.env.WORLD_DEMO_DB ?? 'data/demo.db');
if (resolve(path) === resolve(import.meta.dirname, '..', 'data/world.db')) throw new Error('refusing to write demo data into the real ledger');
if (existsSync(path)) {
  console.error(`${path} already exists. Delete it to rebuild the demo.`);
  process.exit(1);
}
mkdirSync(dirname(path), { recursive: true });
const ledger = new Ledger({ path });

const marc: Profile = { id: 'marc', role: 'owner', writeScope: ['*'] };
const dm: Profile = { id: 'dm', role: 'dm', writeScope: ['*'] };
const mayor = (city: string): Profile => ({ id: `mayor-${city}`, role: 'mayor', writeScope: [city] });
const persona = { voice: 'warm, concise', temperament: 'steady' };

const intent = (type: string, city: string, payload: Record<string, unknown>) => {
  const e = ledger.append(marc, { type: `intent.${type}`, city, payload });
  ledger.append(dm, { type: 'dm.routed', city, payload: { intentSeq: e.seq, to: `mayor:${city}` } });
  return e;
};
const fact = (by: Profile, input: AppendInput) => ledger.append(by, input);

function city(name: string, family: string, mayorName: string) {
  const payload = { name, family, mayorName };
  const i = intent('create_city', 'WORLD', payload);
  return fact(dm, { type: 'city.created', city: 'WORLD', payload, authorizedBy: i.seq }).subject!;
}
function district(c: string, name: string, supervisor: string) {
  const payload = { name, supervisor };
  const i = intent('create_district', c, payload);
  return fact(mayor(c), { type: 'district.created', city: c, payload, authorizedBy: i.seq }).subject!;
}
function department(c: string, districtId: string, name: string, scope: string, extra: Record<string, unknown> = {}) {
  const payload = { districtId, name, scope, ...extra };
  const i = intent('create_department', c, payload);
  return fact(mayor(c), { type: 'department.created', city: c, payload, authorizedBy: i.seq }).subject!;
}
function collegeAgent(c: string, domainFocus: string) {
  const i = intent('create_agent', c, { persona, domainFocus });
  return fact(mayor(c), { type: 'agent.enrolled', city: c, payload: i.payload, authorizedBy: i.seq }).subject!;
}
function place(c: string, id: string, departmentId: string) {
  const i = intent('place_agent', c, { agentId: id, departmentId });
  fact(mayor(c), { type: 'agent.placed', city: c, subject: id, payload: { departmentId }, authorizedBy: i.seq });
}
function professor(c: string, departmentId: string) {
  const i = intent('create_professor', c, { persona, domainFocus: 'teaching', departmentId });
  return fact(mayor(c), { type: 'professor.enrolled', city: c, payload: i.payload, authorizedBy: i.seq }).subject!;
}
function graduate(c: string, id: string, prof: string) {
  fact(mayor(c), { type: 'agent.interned', city: c, subject: id, payload: {} });
  fact(mayor(c), { type: 'exam.graded', city: c, subject: id, payload: { professorId: prof, result: 'pass' } });
  fact(mayor(c), { type: 'agent.graduated', city: c, subject: id, payload: {} });
}
function promote(c: string, id: string, to: 'active' | 'senior') {
  const i = intent('promote_agent', c, { agentId: id, to });
  fact(mayor(c), { type: 'agent.promoted', city: c, subject: id, payload: { to }, authorizedBy: i.seq });
}
const status = (c: string, id: string, st: string, activity: string) =>
  fact(mayor(c), { type: 'agent.status', city: c, subject: id, payload: { status: st, activity } });
function pulses(c: string, metric: string, values: number[], target: number) {
  const start = Date.parse('2026-08-03');
  values.forEach((value, w) => {
    const periodStart = new Date(start + w * 7 * 86_400_000).toISOString().slice(0, 10);
    fact(mayor(c), { type: 'city.kpi_pulse', city: c, payload: { metric, value, target, period: 'week', periodStart } });
  });
}

// ---- cities ----
const reception = city('AI Receptionist City', 'revenue', 'Ana');
const finance = city('Personal Finance City', 'revenue', 'Greg');
const gaming = city('GGClutchPlays', 'revenue', 'Kevin');
const innovations = city('Innovations City', 'essentials', 'Soren');
const security = city('Security City', 'essentials', 'Odette');
const claudeCity = city('Claude Research City', 'claude', 'Imani');
const geminiCity = city('Gemini Studio', 'gemini', 'Pax');

// ---- AI Receptionist City ----
const frontDesk = district(reception, 'Front Desk', 'Rowe');
const booking = department(reception, frontDesk, 'Booking', 'Book qualified appointments for dental, HVAC, med-spa and law clients', {
  maxGraduated: 5,
  maxShadows: 2,
  basicTasks: ['draft follow-up email', 'log call notes'],
});
const intake = department(reception, frontDesk, 'Lead Intake', 'Answer and qualify inbound leads', { maxGraduated: 3 });
const i = intent('create_dean', reception, { persona, domainFocus: 'running the college' });
const dean = fact(mayor(reception), { type: 'dean.appointed', city: reception, payload: i.payload, authorizedBy: i.seq }).subject!;
const profBooking = professor(reception, booking);
professor(reception, intake);

const team = [0, 1, 2, 3].map(() => {
  const id = collegeAgent(reception, 'dental and HVAC bookings');
  place(reception, id, booking);
  graduate(reception, id, profBooking);
  return id;
});
promote(reception, team[0]!, 'active');
promote(reception, team[0]!, 'senior');
promote(reception, team[1]!, 'active');
const shadow = collegeAgent(reception, 'bookings');
place(reception, shadow, booking);
fact(mayor(reception), { type: 'agent.interned', city: reception, subject: shadow, payload: {} });
fact(mayor(reception), { type: 'task.delegated', city: reception, subject: shadow, payload: { fromAgentId: team[0], task: 'log call notes' } });
const intakeAgent = collegeAgent(reception, 'lead qualification');
place(reception, intakeAgent, intake);
collegeAgent(reception, 'med-spa bookings'); // waiting at the college
fact(mayor(reception), { type: 'department.role_requested', city: reception, payload: { departmentId: intake, role: 'evening call coverage' } });
const success = district(reception, 'Client Success', 'Hale');
const followUps = department(reception, success, 'Follow-ups', 'Confirm, remind and rebook appointments');
const profFollow = professor(reception, followUps);
const follower = collegeAgent(reception, 'appointment reminders');
place(reception, follower, followUps);
graduate(reception, follower, profFollow);
status(reception, follower, 'working', 'Sending tomorrow\'s reminders');
pulses(reception, 'qualified_bookings', [12, 18, 21, 26, 24, 31, 35, 38], 40);
status(reception, team[0]!, 'working', 'Booking a cleaning for Bright Smile Dental');
status(reception, team[1]!, 'working', 'Qualifying an HVAC lead');
status(reception, team[2]!, 'idle', 'Waiting for the next call');
fact(mayor(reception), { type: 'dean.reviewed', city: reception, payload: { deanId: dean, rating: 'meets', notes: 'Graduates are booking steadily.' } });

// ---- Economy: deliverables, a QC rework, an earning and a reward ----
const week = '2026-09-21';
const deliverable = (agentId: string, ref: string, cents: number, description: string) =>
  fact(mayor(reception), {
    type: 'work.deliverable',
    city: reception,
    payload: { agentId, artifactRef: `bookings/${ref}`, revenue: 'real', revenueRef: `invoice/${ref}`, revenueCents: cents, periodStart: week, description },
  });
const d1 = deliverable(team[0]!, '1001', 250_000, 'Bright Smile Dental: 3-month booking retainer');
deliverable(team[1]!, '1002', 150_000, 'HVAC client setup fee');
fact(mayor(reception), { type: 'work.qc_rework', city: reception, payload: { agentId: team[1], artifactRef: 'bookings/1002', periodStart: week, reason: 'wrong service area' } });
const e1 = intent('grant_earning', reception, { agentId: team[0], deliverableSeq: d1.seq, amountCents: 12_500 });
fact(mayor(reception), { type: 'currency.earned', city: reception, payload: { agentId: team[0], deliverableSeq: d1.seq, amountCents: 12_500 }, authorizedBy: e1.seq });
const r1 = intent('grant_reward', reception, { agentId: team[0], reward: 'R5', amountCents: 2_500, detail: 'Hall of Agents: first retainer booked' });
fact(mayor(reception), { type: 'currency.spent', city: reception, payload: { agentId: team[0], reward: 'R5', amountCents: 2_500, detail: 'Hall of Agents: first retainer booked' }, authorizedBy: r1.seq });

// ---- Personal Finance City ----
const content = district(finance, 'Content', 'Quill');
const research = department(finance, content, 'Research', 'Personal finance explainers');
const prof2 = professor(finance, research);
const writer = collegeAgent(finance, 'budgeting explainers');
place(finance, writer, research);
graduate(finance, writer, prof2);
pulses(finance, 'published_explainers', [2, 3, 3, 5], 4);

// ---- GGClutchPlays ----
const gamingD = district(gaming, 'Gaming', 'Gaming Supervisor');
const editor = department(gaming, gamingD, 'Video Editor', 'Cut and QC clips');
const prof3 = professor(gaming, editor);
const clipper = collegeAgent(gaming, 'FPS highlights');
place(gaming, clipper, editor);
graduate(gaming, clipper, prof3);
pulses(gaming, 'clips_passing_qc', [14, 11, 16, 19, 22], 20);
status(gaming, clipper, 'working', 'Rendering a clutch highlight');

// ---- Claude and Gemini: one city each ----
for (const [c, dName, focus] of [[claudeCity, 'Analysis', 'literature review'], [geminiCity, 'Design', 'visual concepts']] as const) {
  const dd = district(c, 'Labs', 'Rowe');
  const dep = department(c, dd, dName, `${dName} work`);
  const pr = professor(c, dep);
  const a1 = collegeAgent(c, focus);
  place(c, a1, dep);
  graduate(c, a1, pr);
  status(c, a1, 'working', `${dName} in progress`);
}

// ---- Security: deploy a guard, 3 task strikes -> 6h jail, a dean report escalated to Marc ----
const patrolD = district(security, 'Patrol', 'Vance');
const patrol = department(security, patrolD, 'Patrol', 'Watch for work not being done');
const profSec = professor(security, patrol);
const guard = collegeAgent(security, 'monitoring');
place(security, guard, patrol);
graduate(security, guard, profSec);
const d = intent('deploy_agent', security, { agentId: guard, toCity: reception });
fact(mayor(security), { type: 'agent.deployed', city: security, subject: guard, payload: { toCity: reception }, authorizedBy: d.seq });
for (let n = 0; n < 3; n++) {
  fact(mayor(security), {
    type: 'security.task_strike',
    city: security,
    payload: { agentId: team[3], observedBy: guard, task: 'daily ledger entry', evidence: `no entry on day ${n + 1}` },
  });
}
const report = fact(mayor(reception), {
  type: 'dean.reported',
  city: reception,
  payload: { deanId: dean, agentId: intakeAgent, reason: 'skipped study sessions', evidence: 'no study log for 3 days' },
});
fact(mayor(security), { type: 'security.escalated', city: security, payload: { reportSeq: report.seq, summary: 'Intake student idle for 3 days' } });

// ---- World Constitution: 1.0.0 ratified; open proposals from Innovations, Security and Bob (via the DM) ----
const doc = readConstitution();
if (doc) {
  const payload = { version: '1.0.0', docRef: CONSTITUTION_DOC_REF, sha256: doc.sha256, summary: 'First World Constitution: the brief and ratified amendments A1-A18.' };
  const i = intent('amend_constitution', 'WORLD', payload);
  fact(dm, { type: 'constitution.amended', city: 'WORLD', payload, authorizedBy: i.seq });
}
fact(mayor(innovations), {
  type: 'constitution.proposed',
  city: innovations,
  payload: {
    proposer: 'Soren',
    title: 'Token cost vs quality review each week',
    rationale: 'Article VII.3 names the review but not its cadence.',
    text: 'Add to Article VII.3: Innovations publishes the token-cost-vs-quality review weekly, alongside the Mayors\' health reports.',
  },
});
fact(mayor(security), {
  type: 'constitution.proposed',
  city: security,
  payload: {
    proposer: 'Odette',
    title: 'Quarantined notes are reviewed within 24 hours',
    rationale: 'Quarantined surface notes wait for a human; nothing says how long.',
    text: 'Add to Article V.3: Security reviews every quarantined note within 24 hours and brings anything unresolved to Marc.',
  },
});
fact(dm, {
  type: 'constitution.proposed',
  city: 'WORLD',
  payload: {
    proposer: 'Bob',
    title: 'Name the college in the world model diagram',
    rationale: 'Clarity for new SOUL authors.',
    text: 'Article I diagram: label COLLEGE as "one per city, run by a dean".',
  },
});

ledger.close();
console.log(`Demo world written to ${path} (${ledger.state.lastSeq} events).`);
console.log('Try it: npm run demo:start   (then open http://localhost:8787)');
