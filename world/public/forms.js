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
  'intent.amend_constitution': 'Constitution amendment',
};
export const plainIntent = (type) => PLAIN[type] ?? type;

/**
 * A modal form. fields: { name, label, type, required, options, value, help, placeholder }.
 * types: text | textarea | select | number | lines | secret | name (text + "Suggest" button).
 * onSubmit(values) sends the request; `repeat` adds "Send and add another".
 */
function openForm(ctx, { title, intro, fields, submitLabel = 'Send to the DM', repeat = false, onSubmit }) {
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
      else out[name] = v;
    }
    return out;
  };

  const send = async (again) => {
    error.textContent = '';
    const values = collect();
    const missing = Object.values(controls).find(({ f, control }) => f.required && !control.value.trim());
    if (missing) {
      error.textContent = `${missing.f.label} is required.`;
      missing.control.focus();
      return;
    }
    try {
      const msg = await onSubmit(values);
      ctx.toast(msg ?? 'Sent to the DM for routing.');
      if (again) {
        for (const { f, control } of Object.values(controls)) if (!f.keep) control.value = f.type === 'select' ? control.value : '';
        Object.values(controls)[0]?.control.focus();
      } else {
        dialog.close();
      }
    } catch (err) {
      error.textContent = err.message;
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
        repeat && h('button', { type: 'button', onclick: () => send(true) }, 'Send and add another'),
        h('button', { type: 'submit', class: 'primary' }, submitLabel))),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('input, select, textarea')?.focus();
}

/** Form openers bound to the dashboard context: { api, toast, data() }. */
export function formsFor(ctx) {
  const intent = (type, city, payload) => ctx.api('/api/events', { method: 'POST', body: { type, city, payload } });
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

    createAgent(city) {
      openForm(ctx, {
        title: `New agent at ${city.name}'s college`,
        intro: 'A beginner agent, enrolled at the college. A department then takes it. Its ID is permanent and never reused.',
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
      openForm(ctx, {
        title: `Assign an agent to ${dept.name}`,
        intro: 'Assigns an EXISTING agent of this city. To make a new one, create it at the college first.',
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
