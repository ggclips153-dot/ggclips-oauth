// DEMO ONLY. Plays the DM and the Mayors for data/demo.db so Marc can try the dashboard's forms
// before the real Telegram bots are connected. Every write goes through the same write-guard as the
// real bots (DM routes the intent, the Mayor executes the fact), so rejected requests stay rejected.
// It refuses to attach to any ledger file not named demo.db: the real world is never auto-executed.
import { basename } from 'node:path';
import type { LedgerEvent } from '../domain/state.ts';
import type { Profile } from '../ledger/guard.ts';
import type { Ledger } from '../ledger/ledger.ts';
import { carryOut } from './executor.ts';

const DM: Profile = { id: 'dm-demo', role: 'dm', writeScope: ['*'] };
const mayor = (city: string): Profile => ({ id: `mayor-demo-${city}`, role: 'mayor', writeScope: [city] });

export function attachDemoAutopilot(ledger: Ledger, dbPath: string, log = (m: string) => console.log(m), { starnetHandles = (_city: string): boolean => false } = {}): () => void {
  if (basename(dbPath) !== 'demo.db') throw new Error('the demo autopilot only runs on data/demo.db, never on the real ledger');
  const later = (ms: number, what: string, fn: () => void) =>
    setTimeout(() => {
      try {
        fn();
      } catch (err) {
        log(`demo autopilot: ${what}: ${(err as Error).message}`);
      }
    }, ms).unref?.();
  const onEvent = (e: LedgerEvent) => {
    const p = e.payload as Record<string, any>;
    // Marc talks to an agent: the demo Mayor answers for it after a moment.
    // (A city with a running StarNet station answers for itself.)
    if (e.type === 'intent.message_agent' && !starnetHandles(e.city)) {
      later(1200, `reply to message #${e.seq}`, () => {
        const a = ledger.state.agents.get(p.agentId);
        if (!a || a.deleted) return;
        ledger.append(mayor(e.city), { type: 'agent.said', city: e.city, subject: a.id, payload: { text: demoReply(ledger, a.id, String(p.text)), replyTo: e.seq } });
      });
    }
    // Marc sends an agent's post back: the demo agent reworks it and resubmits it for approval.
    if (e.type === 'social.post_rejected') {
      const post = ledger.state.social.posts.get(p.postId);
      if (post?.author.kind === 'agent') {
        later(4000, `revise post ${p.postId}`, () => {
          const cur = ledger.state.social.posts.get(p.postId);
          if (cur?.status !== 'rejected') return;
          const text = `${cur.text.replace(/\s*\(revised.*\)$/s, '')} (revised: ${String(p.reason).slice(0, 80)})`;
          ledger.append(mayor(e.city), { type: 'social.agent_revised', city: e.city, payload: { postId: cur.id, text: text.slice(0, 2000), note: `Reworked after your feedback: "${String(p.reason).slice(0, 200)}"` } });
        });
      }
    }
    if (e.kind !== 'intent') return;
    // Run after the current append has finished.
    setImmediate(() => {
      // Already routed (e.g. Marc's own creation requests are applied at once): nothing left to do.
      if (ledger.state.routed.has(e.seq)) return;
      try {
        carryOut(ledger, e, { dm: DM, mayor });
      } catch (err) {
        log(`demo autopilot: intent #${e.seq} (${e.type}) not carried out: ${(err as Error).message}`);
      }
    });
  };
  ledger.events.on('event', onEvent);
  log('DEMO AUTOPILOT ON: acting as the DM and every Mayor for demo.db');
  return () => ledger.events.off('event', onEvent);
}

/** A stand-in answer for the demo; real answers come from the city's Mayor bot, speaking for its agent. */
function demoReply(ledger: Ledger, agentId: string, text: string): string {
  const st = ledger.state;
  const a = st.agents.get(agentId)!;
  const dept = a.departmentId ? st.departments.get(a.departmentId)?.name : null;
  const where = a.role === 'dean' ? 'dean of the college' : a.role === 'professor' ? 'professor at the college' : dept ? `${a.state} in ${dept}` : `${a.state}, at the college waiting for a department`;
  const doing = a.status?.activity ? `Right now: ${a.status.activity}.` : a.status ? `I'm ${a.status.status} at the moment.` : '';
  const rejected = [...st.social.posts.values()].filter((p) => p.author.kind === 'agent' && p.author.id === agentId && p.status === 'rejected').length;
  const q = /\?\s*$/.test(text.trim());
  return [
    `Hi Marc, ${a.name} here (${where}).`,
    doing,
    rejected ? `I have ${rejected} post(s) you sent back; I'm reworking them.` : '',
    q ? 'Good question: I\'ll check and report back through the Mayor.' : 'Understood, I\'ll take care of it.',
    '(Demo world: in the real world this reply comes from the Mayor bot speaking for me.)',
  ].filter(Boolean).join(' ');
}
