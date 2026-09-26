// Talk to one agent directly. Marc's messages are requests (intent.message_agent) routed to the agent's city
// Mayor, whose bot relays them and writes the agent's answers (agent.said). The conversation lives in the
// ledger, so it survives restarts and updates live.
import { h } from './dom.js';

let open = null; // { agentId, dialog, thread, head, count, ctx }

/** Open the conversation with an agent. `ctx`: { data(), index(), api, toast, scheduleRefresh, isOwner, statusChip, ago }. */
export function openAgentChat(ctx, agentId) {
  open?.dialog.close();
  const dialog = h('dialog', { class: 'modal chat', 'aria-label': 'Conversation with an agent' });
  const head = h('div', { class: 'chat-head' });
  const thread = h('div', { class: 'chat-thread', role: 'log', 'aria-live': 'polite' });
  const error = h('p', { class: 'error', role: 'alert' });
  const box = h('textarea', { rows: 2, placeholder: 'Message…', 'aria-label': 'Message to the agent' });
  const sendBtn = h('button', { type: 'submit', class: 'primary' }, 'Send');
  let busy = false;
  const send = async (ev) => {
    ev?.preventDefault();
    const text = box.value.trim();
    if (!text || busy) return;
    const a = ctx.index().agents.get(agentId);
    if (!a) return;
    busy = true;
    sendBtn.disabled = true;
    error.textContent = '';
    try {
      const e = await ctx.api('/api/events', { method: 'POST', body: { type: 'intent.message_agent', city: a.cityId, payload: { agentId, text } } });
      if (e.applied === false) throw new Error(e.reason);
      box.value = '';
      ctx.scheduleRefresh();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      busy = false;
      sendBtn.disabled = false;
      box.focus();
    }
  };
  // Enter sends, Shift+Enter starts a new line.
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) send(ev);
  });
  dialog.append(
    head,
    thread,
    ctx.isOwner()
      ? h('form', { class: 'chat-compose', onsubmit: send }, box, sendBtn)
      : h('p', { class: 'small muted' }, 'Only Marc can message agents.'),
    error,
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => dialog.close() }, 'Close')));
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (open?.dialog === dialog) open = null;
  });
  document.body.append(dialog);
  open = { agentId, dialog, thread, head, count: -1, ctx };
  refreshChat();
  dialog.showModal();
  thread.scrollTop = thread.scrollHeight;
  box.focus?.();
}

/** Redraw the open conversation after new data arrives (called on every dashboard render). */
export function refreshChat() {
  if (!open) return;
  const { ctx, agentId, thread, head } = open;
  const ix = ctx.index();
  const a = ix.agents.get(agentId);
  if (!a) {
    head.replaceChildren(h('h2', {}, 'Agent not found'));
    return;
  }
  const data = ctx.data();
  const city = data.cities.find((c) => c.id === a.cityId);
  const dept = a.departmentId ? ix.depts.get(a.departmentId) : null;
  const role = a.role === 'dean' ? 'Dean' : a.role === 'professor' ? 'Professor' : a.state ? a.state[0].toUpperCase() + a.state.slice(1) : 'Agent';
  const sentBack = (data.social?.posts ?? []).filter((p) => p.author.kind === 'agent' && p.author.id === agentId && p.status === 'rejected');
  head.replaceChildren(
    h('div', { class: 'row-head' },
      h('div', {},
        h('h2', {}, a.name),
        h('div', { class: 'small secondary' }, [role, dept ? dept.name : a.role === 'agent' ? 'at the college' : 'college', city?.name].filter(Boolean).join(' · '), ' ', h('span', { class: 'mono muted' }, a.id))),
      a.status ? h('div', { class: 'small secondary chat-status' }, h('b', {}, a.status.status), a.status.activity ? ` · ${a.status.activity}` : '') : null),
    ...(sentBack.length ? [h('p', { class: 'small' }, `${sentBack.length} post(s) you rejected are back with ${a.name} for rework.`)] : []));
  const msgs = data.chats?.[agentId] ?? [];
  if (msgs.length === open.count) return;
  open.count = msgs.length;
  thread.replaceChildren(
    ...(msgs.length
      ? msgs.map((m) => h('div', { class: `bubble ${m.from === 'marc' ? 'you' : 'them'}` }, m.text, h('div', { class: 'muted small' }, `${m.from === 'marc' ? 'You' : a.name} · ${new Date(m.ts).toLocaleString()}`)))
      : [h('p', { class: 'muted small' }, `No messages yet. Say something to ${a.name}; the ${city?.name ?? 'city'} Mayor's bot passes it on and answers for the agent.`)]),
    ...(msgs.length && msgs.at(-1).from === 'marc' ? [h('p', { class: 'muted small typing' }, `Waiting for ${a.name}…`)] : []),
  );
  thread.scrollTop = thread.scrollHeight;
}

/** An agent's name as a button that opens the conversation. */
export function agentName(ctx, a) {
  return h('button', { type: 'button', class: 'linkish', title: `Talk to ${a.name}`, onclick: () => openAgentChat(ctx, a.id) }, a.name);
}
