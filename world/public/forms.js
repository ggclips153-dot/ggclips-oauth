// Marc's forms. Every form writes an INTENT to the ledger; nothing changes until the DM routes it and
// the Mayor carries it out. The server's write-guard re-checks everything, so these forms only help.
import { h } from './dom.js';

const FAMILY_OPTIONS = [
  ['revenue', 'Revenue (primary)'],
  ['claude', 'Claude (expansion)'],
  ['gemini', 'Gemini (expansion)'],
  ['essentials', 'Essentials'],
];

const PLAIN = {
  'intent.create_city': 'New city',
  'intent.create_district': 'New district',
  'intent.create_department': 'New department',
  'intent.configure_department': 'Department settings',
  'intent.create_agent': 'New agent',
  'intent.place_agent': 'Assign agent to department',
  'intent.promote_agent': 'Promotion',
  'intent.move_agent': 'Move agent',
  'intent.delete_agent': 'Delete agent',
  'intent.create_professor': 'New professor',
  'intent.specialize_professor': 'Professor specialty',
  'intent.create_dean': 'New dean',
  'intent.replace_dean': 'Replace dean',
  'intent.retire_to_professor': 'Retire into professor',
  'intent.deploy_agent': 'Deploy Security agent',
  'intent.message_mayor': 'Message to Mayor',
  'intent.grant_earning': 'Earning credit',
  'intent.grant_reward': 'Reward',
  'intent.amend_constitution': 'Ratify Constitution version',
  'intent.decline_proposal': 'Decline Constitution proposal',
};
export const plainIntent = (type) => PLAIN[type] ?? type;

/**
 * Dollars typed by a person -> integer cents, or NaN when unclear. Accepts "1250", "1,250.50",
 * "$12.5" and a decimal comma ("12,50"); rejects anything ambiguous rather than guessing.
 */
export function parseMoney(text) {
  const t = text.replace(/[$\s]/g, '');
  let n = NaN;
  if (/^\d+(\.\d{1,2})?$/.test(t)) n = Number(t);
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) n = Number(t.replaceAll(',', ''));
  else if (/^\d+,\d{1,2}$/.test(t)) n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/**
 * A modal form. fields: { name, label, type, required, options, value, help, placeholder }.
 * types: text | textarea | select | number | lines | secret | name (text + "Suggest" button).
 * onSubmit(values) sends the request; `repeat` adds "Send and add another".
 */
function openForm(ctx, { title, intro, fields, submitLabel: label, repeat = false, createNow = false, onSubmit }) {
  // Creation forms apply at once (the server carries Marc's creation requests out immediately); others go to the DM.
  const submitLabel = label ?? (createNow ? 'Create' : 'Send to the DM');
  const dialog = h('dialog', { class: 'modal', 'aria-labelledby': 'form-title' });
  const error = h('p', { class: 'error', role: 'alert' });
  const controls = {};

  const fieldEl = (f) => {
    const id = `f-${f.name}`;
    let control;
    if (f.type === 'select') {
      control = h('select', { id, name: f.name, required: f.required },
        !f.required && h('option', { value: '' }, '—'),
        f.options.map(([v, label]) => h('option', { value: v, selected: v === f.value }, label)));
    } else if (f.type === 'textarea' || f.type === 'lines') {
      control = h('textarea', { id, name: f.name, rows: f.type === 'lines' ? 4 : 3, required: f.required, placeholder: f.placeholder });
      if (f.value) control.value = f.value;
    } else {
      control = h('input', {
        id,
        name: f.name,
        type: f.type === 'number' ? 'number' : f.type === 'secret' ? 'password' : 'text',
        inputmode: f.type === 'money' ? 'decimal' : null,
        min: f.type === 'number' ? 0 : null,
        required: f.required,
        placeholder: f.placeholder,
        autocomplete: 'off',
      });
      if (f.value != null) control.value = f.value;
    }
    controls[f.name] = { f, control };
    const suggest =
      f.type === 'name'
        ? h('button', {
            type: 'button',
            class: 'ghost',
            onclick: async () => {
              const { names } = await ctx.api('/api/names?count=1');
              control.value = names[0];
            },
          }, 'Suggest a name')
        : null;
    return h('div', { class: 'field' },
      h('label', { for: id }, f.label, f.required ? null : h('span', { class: 'muted' }, ' (optional)')),
      suggest ? h('div', { class: 'with-button' }, control, suggest) : control,
      f.help && h('p', { class: 'help' }, f.help));
  };

  const collect = () => {
    const out = {};
    for (const [name, { f, control }] of Object.entries(controls)) {
      const v = control.value.trim();
      if (!v) continue;
      if (f.type === 'number') out[name] = Number(v);
      else if (f.type === 'lines') out[name] = v.split('\n').map((x) => x.trim()).filter(Boolean);
      else if (f.type === 'money') out[name] = parseMoney(v);
      else out[name] = v;
    }
    return out;
  };

  let busy = false;
  const send = async (again) => {
    if (busy) return; // a double-click must not send the request twice
    error.textContent = '';
    const values = collect();
    const missing = Object.values(controls).find(({ f, control }) => f.required && !control.value.trim());
    if (missing) {
      error.textContent = `${missing.f.label} is required.`;
      missing.control.focus();
      return;
    }
    busy = true;
    for (const b of dialog.querySelectorAll('button')) b.disabled = true;
    try {
      const msg = await onSubmit(values);
      if (createNow) ctx.toast(`${(msg ?? 'Done').replace(/ sent to the DM\.?$/, '')}: done.`);
      else {
        const pendingNote = ctx.noDm?.() ? ' It waits under "Waiting on the DM" until a DM bot routes it.' : '';
        ctx.toast(`${msg ?? 'Sent to the DM for routing.'}${pendingNote}`);
      }
      if (again) {
        for (const { f, control } of Object.values(controls)) if (!f.keep) control.value = f.type === 'select' ? control.value : '';
        Object.values(controls)[0]?.control.focus();
      } else {
        dialog.close();
      }
    } catch (err) {
      error.textContent = err.message;
    } finally {
      busy = false;
      for (const b of dialog.querySelectorAll('button')) b.disabled = false;
    }
  };

  dialog.append(
    h('form', { onsubmit: (ev) => { ev.preventDefault(); send(false); } },
      h('h2', { id: 'form-title' }, title),
      intro && h('p', { class: 'secondary small' }, intro),
      fields.map(fieldEl),
      error,
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        repeat && h('button', { type: 'button', onclick: () => send(true) }, createNow ? 'Create and add another' : 'Send and add another'),
        h('button', { type: 'submit', class: 'primary' }, submitLabel))),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('input, select, textarea')?.focus();
}

/** Form openers bound to the dashboard context: { api, toast, data() }. */
export function formsFor(ctx) {
  const intent = async (type, city, payload) => {
    const e = await ctx.api('/api/events', { method: 'POST', body: { type, city, payload } });
    // A creation the rules refused is kept as a waiting request; say why instead of claiming success.
    if (e.applied === false) throw new Error(`Not created: ${e.reason}`);
    return e;
  };
  const departmentsOf = (city) => city.districts.flatMap((d) => d.departments.map((dp) => [dp.id, `${dp.name} (${d.name})`]));
  const personaFields = [
    { name: 'voice', label: 'Persona voice', type: 'text', required: true, placeholder: 'e.g. warm, concise, professional', keep: true },
    { name: 'temperament', label: 'Temperament', type: 'text', required: true, placeholder: 'e.g. patient, steady under pressure', keep: true },
    { name: 'domainFocus', label: 'Domain focus', type: 'textarea', required: true, placeholder: 'What this agent specialises in', keep: true },
  ];
  const personaPayload = (v) => ({ ...(v.name ? { name: v.name } : {}), persona: { voice: v.voice, temperament: v.temperament }, domainFocus: v.domainFocus });

  return {
    newCity() {
      openForm(ctx, {
        createNow: true,
        title: 'New city',
        intro: 'One business endeavor, with its own Mayor. The DM creates it once routed.',
        repeat: true,
        fields: [
          { name: 'name', label: 'City name', type: 'text', required: true },
          { name: 'family', label: 'Family', type: 'select', required: true, options: FAMILY_OPTIONS, value: 'revenue', keep: true },
          { name: 'mayorName', label: 'Mayor name', type: 'name', required: true },
          { name: 'districts', label: 'Initial districts', type: 'lines', placeholder: 'One per line: District name | supervisor\nFront Desk | Rowe', help: 'Each line: district name, a | and its supervisor.' },
        ],
        onSubmit: async (v) => {
          const initialDistricts = (v.districts ?? []).map((line) => {
            const [name, supervisor] = line.split('|').map((x) => x.trim());
            if (!name || !supervisor) throw new Error(`"${line}" needs a district name and a supervisor, separated by |`);
            return { name, supervisor };
          });
          await intent('intent.create_city', 'WORLD', { name: v.name, family: v.family, mayorName: v.mayorName, ...(initialDistricts.length ? { initialDistricts } : {}) });
          return `New city "${v.name}" sent to the DM.`;
        },
      });
    },

    newDistrict(city) {
      openForm(ctx, {
        createNow: true,
        title: `New district in ${city.name}`,
        repeat: true,
        fields: [
          { name: 'name', label: 'District name', type: 'text', required: true },
          { name: 'supervisor', label: 'Supervisor', type: 'name', required: true },
        ],
        onSubmit: async (v) => {
          await intent('intent.create_district', city.id, v);
          return `District "${v.name}" sent to the DM.`;
        },
      });
    },

    newDepartment(city, district) {
      openForm(ctx, {
        createNow: true,
        title: `New department in ${district.name}`,
        intro: 'A department is the agents who specialise in it. Caps are optional.',
        repeat: true,
        fields: [
          { name: 'name', label: 'Department name', type: 'text', required: true },
          { name: 'scope', label: 'Scope', type: 'textarea', required: true, placeholder: 'What this department is responsible for' },
          { name: 'maxGraduated', label: 'Cap on working (graduated) agents', type: 'number', help: 'Leave blank for no cap.' },
          { name: 'maxShadows', label: 'Cap on shadows (interns)', type: 'number', help: 'Leave blank for no cap.' },
          { name: 'basicTasks', label: 'Basic tasks graduated agents may hand to shadows', type: 'lines', placeholder: 'One task per line' },
          { name: 'botToken', label: 'Telegram bot token', type: 'secret', help: 'Stored as a secret on the server. Only its name goes into the ledger.' },
        ],
        onSubmit: async ({ botToken, ...v }) => {
          const botTokenRef = botToken ? (await ctx.api('/api/secrets', { method: 'POST', body: { purpose: `${v.name}-bot`, value: botToken } })).ref : undefined;
          await intent('intent.create_department', city.id, { districtId: district.id, ...v, ...(botTokenRef ? { botTokenRef } : {}) });
          return `Department "${v.name}" sent to the DM.`;
        },
      });
    },

    departmentSettings(city, dept) {
      openForm(ctx, {
        title: `${dept.name} settings`,
        intro: 'Replaces the caps and basic-task list. Blank = no cap / no tasks.',
        fields: [
          { name: 'maxGraduated', label: 'Cap on working (graduated) agents', type: 'number', value: dept.maxGraduated ?? '' },
          { name: 'maxShadows', label: 'Cap on shadows (interns)', type: 'number', value: dept.maxShadows ?? '' },
          { name: 'basicTasks', label: 'Basic tasks for shadows', type: 'lines', value: dept.basicTasks.join('\n') },
        ],
        onSubmit: async (v) => {
          await intent('intent.configure_department', city.id, { departmentId: dept.id, ...v });
          return `New settings for ${dept.name} sent to the DM.`;
        },
      });
    },

    /** New agents are created only here, at the city's college (A11). A department then takes an existing one. */
    createAgent(city) {
      openForm(ctx, {
        createNow: true,
        title: `New agent at ${city.name}'s college`,
        intro: 'A beginner agent, enrolled at the college. A department then takes it with "Assign agent". Its ID is permanent and never reused.',
        repeat: true,
        fields: [{ name: 'name', label: 'Display name', type: 'name', help: 'Leave blank and one is generated for you.' }, ...personaFields],
        onSubmit: async (v) => {
          await intent('intent.create_agent', city.id, personaPayload(v));
          return `New agent${v.name ? ` "${v.name}"` : ''} sent to the DM.`;
        },
      });
    },

    createProfessor(city) {
      openForm(ctx, {
        createNow: true,
        title: `New professor at ${city.name}'s college`,
        intro: 'Teaches, gives exams and judges fitness to graduate. Steps in only at its specialty department when needed.',
        repeat: true,
        fields: [
          { name: 'name', label: 'Display name', type: 'name', help: 'Leave blank and one is generated for you.' },
          { name: 'departmentId', label: 'Specialty department', type: 'select', options: departmentsOf(city), keep: true },
          ...personaFields,
        ],
        onSubmit: async (v) => {
          await intent('intent.create_professor', city.id, { ...personaPayload(v), ...(v.departmentId ? { departmentId: v.departmentId } : {}) });
          return 'New professor sent to the DM.';
        },
      });
    },

    createDean(city) {
      openForm(ctx, {
        createNow: true,
        title: `Dean for ${city.name}'s college`,
        intro: 'Manages the professors. Judged by the Mayor on how the college\'s graduates perform.',
        fields: [{ name: 'name', label: 'Display name', type: 'name', help: 'Leave blank and one is generated for you.' }, ...personaFields],
        onSubmit: async (v) => {
          await intent('intent.create_dean', city.id, personaPayload(v));
          return 'New dean sent to the DM.';
        },
      });
    },

    replaceDean(city) {
      openForm(ctx, {
        title: `Replace the dean of ${city.name}`,
        intro: 'An outstanding professor becomes dean. The current dean returns to teaching.',
        fields: [{ name: 'professorId', label: 'Professor', type: 'select', required: true, options: city.college.professors.map((p) => [p.id, `${p.name} (${p.id})`]) }],
        onSubmit: async (v) => {
          await intent('intent.replace_dean', city.id, v);
          return 'Dean replacement sent to the DM.';
        },
      });
    },

    specialize(city, prof) {
      openForm(ctx, {
        title: `${prof.name}'s specialty`,
        fields: [{ name: 'departmentId', label: 'Specialty department', type: 'select', required: true, options: departmentsOf(city), value: prof.specialtyDepartmentId }],
        onSubmit: async (v) => {
          await intent('intent.specialize_professor', city.id, { professorId: prof.id, departmentId: v.departmentId });
          return 'Specialty change sent to the DM.';
        },
      });
    },

    assignAgent(city, dept) {
      const waiting = city.college.enrolled.map((a) => [a.id, `${a.name} (${a.id}) · at the college`]);
      const movable = city.districts
        .flatMap((d) => d.departments)
        .filter((dp) => dp.id !== dept.id)
        .flatMap((dp) => dp.agents.map((a) => [`move:${a.id}`, `${a.name} (${a.id}) · ${a.state} in ${dp.name}`]));
      if (!waiting.length && !movable.length) {
        ctx.toast(`No agent in ${city.name} to assign yet. Create one at the college first ("+ Create agent" in the College section), then assign it here.`);
        return;
      }
      openForm(ctx, {
        createNow: true,
        title: `Assign an agent to ${dept.name}`,
        intro: 'Assigns an EXISTING agent of this city: one waiting at the college, or one moved from another department. New agents are created only at the college.',
        repeat: true,
        fields: [{ name: 'agent', label: 'Agent', type: 'select', required: true, options: [...waiting, ...movable] }],
        onSubmit: async (v) => {
          if (v.agent.startsWith('move:')) await intent('intent.move_agent', city.id, { agentId: v.agent.slice(5), toDepartmentId: dept.id });
          else await intent('intent.place_agent', city.id, { agentId: v.agent, departmentId: dept.id });
          return `Assignment to ${dept.name} sent to the DM.`;
        },
      });
    },

    promote(city, agent, to) {
      openForm(ctx, {
        title: `Promote ${agent.name}`,
        intro: `${agent.name} (${agent.id}) goes from ${agent.state} to ${to}. The Mayor carries it out.`,
        fields: [],
        submitLabel: `Promote to ${to}`,
        onSubmit: async () => {
          await intent('intent.promote_agent', city.id, { agentId: agent.id, to });
          return `Promotion of ${agent.name} sent to the DM.`;
        },
      });
    },

    retire(city, agent) {
      openForm(ctx, {
        title: `Retire ${agent.name} into a professor`,
        intro: `${agent.name} keeps its ID and name, leaves its department and teaches at the college.`,
        fields: [{ name: 'departmentId', label: 'Specialty department', type: 'select', options: departmentsOf(city), value: agent.departmentId, help: 'Defaults to its current department.' }],
        submitLabel: 'Retire into professor',
        onSubmit: async (v) => {
          await intent('intent.retire_to_professor', city.id, { agentId: agent.id, ...(v.departmentId ? { departmentId: v.departmentId } : {}) });
          return `Retirement of ${agent.name} sent to the DM.`;
        },
      });
    },

    remove(city, agent) {
      openForm(ctx, {
        title: `Delete ${agent.name}?`,
        intro: `${agent.name}'s ID and name are retired forever. Its ledger is frozen and archived; only a lesson record carries on. This cannot be undone.`,
        fields: [],
        submitLabel: 'Delete agent',
        onSubmit: async () => {
          await intent('intent.delete_agent', city.id, { agentId: agent.id });
          return `Deletion of ${agent.name} sent to the DM.`;
        },
      });
    },

    deploy(city, cities) {
      const guards = city.districts.flatMap((d) => d.departments).flatMap((dp) => dp.agents)
        .filter((a) => ['probationer', 'active', 'senior'].includes(a.state))
        .map((a) => [a.id, `${a.name} (${a.id})${a.deployedTo ? ` · now watching ${a.deployedTo}` : ''}`]);
      openForm(ctx, {
        title: 'Deploy a Security agent',
        intro: 'A deployed agent watches one city and can record task strikes there.',
        fields: [
          { name: 'agentId', label: 'Security agent', type: 'select', required: true, options: guards },
          { name: 'toCity', label: 'City to watch', type: 'select', required: true, options: cities.map((c) => [c.id, c.name]) },
        ],
        onSubmit: async (v) => {
          await intent('intent.deploy_agent', city.id, v);
          return 'Deployment sent to the DM.';
        },
      });
    },

    grantEarning(city, deliverable, agent) {
      const revenue = deliverable.revenueCents != null ? ` from $${(deliverable.revenueCents / 100).toLocaleString()} of revenue` : '';
      openForm(ctx, {
        title: `Credit ${agent.name}`,
        intro: `For "${deliverable.description}"${revenue}, week of ${deliverable.periodStart}. Earnings are yours and the Mayor's to grant; the agent never holds or spends them.`,
        fields: [{ name: 'amountCents', label: 'Amount (dollars)', type: 'money', required: true, placeholder: 'e.g. 125.00' }],
        submitLabel: 'Credit',
        onSubmit: async (v) => {
          if (!Number.isFinite(v.amountCents) || v.amountCents <= 0) throw new Error('Enter an amount above $0.');
          await intent('intent.grant_earning', city.id, { agentId: agent.id, deliverableSeq: deliverable.seq, amountCents: v.amountCents });
          return `Credit for ${agent.name} sent to the DM.`;
        },
      });
    },

    grantReward(city, agent, account, rewards) {
      openForm(ctx, {
        title: `Reward for ${agent.name}`,
        intro: `Balance $${(account.balanceCents / 100).toFixed(2)}. Rewards are upgrades only: never authority, cross-city reach, skipping school, memory or knowledge, a ledger exemption, or deletion-immunity.`,
        fields: [
          { name: 'reward', label: 'Reward', type: 'select', required: true, options: Object.entries(rewards) },
          { name: 'amountCents', label: 'Cost (dollars)', type: 'money', required: true, placeholder: 'e.g. 25.00' },
          { name: 'detail', label: 'What exactly is granted', type: 'textarea', required: true },
        ],
        submitLabel: 'Grant reward',
        onSubmit: async (v) => {
          if (!Number.isFinite(v.amountCents) || v.amountCents < 0) throw new Error('Enter a cost of $0 or more.');
          await intent('intent.grant_reward', city.id, { agentId: agent.id, ...v });
          return `Reward for ${agent.name} sent to the DM.`;
        },
      });
    },

    /** Ratify the file on disk as a new version (Article X). `info` is /api/constitution. */
    ratifyConstitution(info, proposal) {
      const cur = info.ratified?.version;
      const [maj, min] = (cur ?? '0.0.0').split('.').map(Number);
      const next = cur ? `${maj}.${min + 1}.0` : '1.0.0';
      openForm(ctx, {
        title: proposal ? `Ratify "${proposal.title}"` : 'Ratify a new Constitution version',
        intro: `Ratifies the file exactly as it is now on disk (sha256 ${info.file.sha256.slice(0, 12)}…). Edit ${info.docRef} first; ratifying records its fingerprint, and SOULs must then carry the new pointer line.`,
        fields: [
          { name: 'version', label: 'Version', type: 'text', required: true, value: next, help: cur ? `Must be newer than ${cur}.` : 'The first ratified version.' },
          { name: 'summary', label: 'What changed', type: 'textarea', required: true, value: proposal ? `${proposal.title} (proposed by ${proposal.proposer}).` : '' },
        ],
        submitLabel: 'Ratify',
        onSubmit: async (v) => {
          await intent('intent.amend_constitution', 'WORLD', {
            version: v.version,
            docRef: info.docRef,
            sha256: info.file.sha256,
            summary: v.summary,
            proposalSeq: proposal?.seq,
          });
          return `Constitution ${v.version} sent to the DM.`;
        },
      });
    },

    declineProposal(proposal) {
      openForm(ctx, {
        title: `Decline "${proposal.title}"`,
        intro: `Proposed by ${proposal.proposer}. The reason is recorded in the ledger.`,
        fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
        submitLabel: 'Decline',
        onSubmit: async (v) => {
          await intent('intent.decline_proposal', 'WORLD', { proposalSeq: proposal.seq, reason: v.reason });
          return 'Decline sent to the DM.';
        },
      });
    },

    messageMayor(city) {
      openForm(ctx, {
        title: `Message Mayor ${city.mayorName}`,
        intro: 'Goes to the DM, who relays it to the Mayor\'s bot.',
        fields: [{ name: 'text', label: 'Message', type: 'textarea', required: true }],
        submitLabel: 'Send',
        onSubmit: async (v) => {
          await intent('intent.message_mayor', city.id, v);
          return `Message for Mayor ${city.mayorName} sent to the DM.`;
        },
      });
    },
  };
}
