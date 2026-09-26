// The Memory tab: the shared memory surface (A21), read-only. Every note carries four tags (city, dept, agent,
// kind). What a reader sees follows the spec's matrix, applied by the server: Marc sees every city and WORLD, a
// Mayor its own city and WORLD. The dashboard never writes the surface.
import { h } from './dom.js';

const KINDS = ['status', 'kpi', 'lifecycle', 'dispatch', 'lesson', 'policy', 'roster', 'note'];
const KIND_LABEL = { roster: 'Roster', kpi: 'KPI', status: 'Status', dispatch: 'Dispatch', lesson: 'Lesson', policy: 'Policy', note: 'Note', lifecycle: 'Lifecycle' };
const filter = { city: '', kind: '', dept: '', q: '' };

/** Open the Memory tab filtered to one city (used from a city's page). */
export function memoryFor(cityId) {
  filter.city = cityId;
  filter.dept = '';
  location.hash = '#/memory';
}

const when = (ts) => (ts ? new Date(ts.includes('T') || ts.includes(' ') ? ts.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? '' : 'Z') : ts).toLocaleString() : '—');
// Mnemosyne labels shared notes ("Surface meta: …"); the four tags already say what the note is.
const text = (s) => String(s ?? '').replace(/^surface (meta|preference|correction|identity|fact):\s*/i, '');
const tag = (v) => (v && v !== '—' ? v : h('span', { class: 'muted' }, '—'));

/** ctx: { data, render, table, statusChip, cityName(id) } */
export function memoryPage(ctx) {
  const s = ctx.data.sharedSurface ?? { enabled: false };
  const head = h('div', { class: 'page-head' }, h('h1', {}, 'Memory'), h('span', { class: 'small secondary' }, 'The shared surface: read-only'));
  if (!s.enabled) {
    return [head, h('div', { class: 'card section' },
      h('h3', {}, 'Not connected yet'),
      h('p', { class: 'secondary' }, 'The shared memory surface lives on your VPS. Run the read-only reader there (vps/surface_reader.py), then start the world with SURFACE_URL and SURFACE_TOKEN. The README has the steps.'))];
  }
  const notes = s.notes ?? [];
  const cityLabel = (n) => (n.cityId === 'WORLD' ? 'WORLD' : n.cityId ? ctx.cityName(n.cityId) : n.city ? `${n.city} (not mapped)` : 'no city tag');
  const cities = [...new Set(notes.map((n) => n.cityId ?? `?${n.city}`))];
  const depts = [...new Set(notes.filter((n) => !filter.city || n.cityId === filter.city).map((n) => n.dept).filter(Boolean))].sort();
  const shown = notes.filter((n) =>
    (!filter.city || n.cityId === filter.city || (filter.city.startsWith('?') && `?${n.city}` === filter.city)) &&
    (!filter.kind || n.kind === filter.kind) &&
    (!filter.dept || n.dept === filter.dept) &&
    (!filter.q || `${n.agent ?? ''} ${n.content}`.toLowerCase().includes(filter.q.toLowerCase())));

  // Latest status per agent, latest KPI pulse per city + department.
  const latest = (kind, key) => {
    const m = new Map();
    for (const n of shown) if (n.kind === kind && !m.has(key(n))) m.set(key(n), n); // notes come newest first
    return [...m.values()];
  };
  const statuses = latest('status', (n) => `${n.cityId}|${n.agent}`);
  const kpis = latest('kpi', (n) => `${n.cityId}|${n.dept}`);
  const untagged = notes.filter((n) => n.untagged?.length);

  const set = (k) => (ev) => {
    filter[k] = ev.target.value;
    if (k === 'city') filter.dept = '';
    ctx.render();
  };
  const bar = h('div', { class: 'toolbar filters' },
    h('select', { 'aria-label': 'City', onchange: set('city') },
      h('option', { value: '' }, 'All cities you can see'),
      cities.map((c) => h('option', { value: c, selected: c === filter.city }, c === 'WORLD' ? 'WORLD (zero-th city)' : c.startsWith('?') ? `${c.slice(1)} (not mapped)` : ctx.cityName(c)))),
    h('select', { 'aria-label': 'Department', onchange: set('dept') },
      h('option', { value: '' }, 'All departments'),
      depts.map((d) => h('option', { value: d, selected: d === filter.dept }, d))),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Kind' },
      [['', 'All'], ...KINDS.map((k) => [k, KIND_LABEL[k]])].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(filter.kind === k), onclick: () => { filter.kind = k; ctx.render(); } }, label))),
    h('input', { type: 'search', placeholder: 'Agent or text…', 'aria-label': 'Search the surface', value: filter.q, onchange: set('q') }));

  return [
    head,
    h('div', { class: 'station-bar' },
      s.ok ? ctx.statusChip('good', 'Reading the surface') : ctx.statusChip('critical', `Can't reach the surface: ${s.error}`),
      h('span', { class: 'small secondary' }, `${s.total ?? notes.length} note(s) you can see${s.lastPoll ? ` · checked ${new Date(s.lastPoll).toLocaleTimeString()}` : ''}`)),
    s.unmappedCities?.length
      ? h('div', { class: 'card section soc-due' },
          h('b', {}, 'Some surface city tags don\'t match a world city: '), s.unmappedCities.join(', '),
          h('span', { class: 'small secondary' }, ' · add them to config/surface-cities.json, e.g. {"receptionist": "ai-receptionist-city"}.'))
      : null,
    untagged.length
      ? h('p', { class: 'small' }, ctx.statusChip('warning', `${untagged.length} note(s) missing a tag`), ' The spec requires all four tags on every note; these are shown as they are.')
      : null,
    bar,
    h('div', { class: 'two-col' },
      h('div', { class: 'card section' }, h('h3', {}, 'Live status'),
        ctx.table(['Agent', 'Where', 'Now', 'When'], statuses.map((n) => [tag(n.agent), `${cityLabel(n)} · ${n.dept ?? '—'}`, h('div', { class: 'small' }, text(n.content)), when(n.ts)]), 'No status notes.')),
      h('div', { class: 'card section' }, h('h3', {}, 'KPI pulses'),
        ctx.table(['City', 'Dept', 'Pulse', 'When'], kpis.map((n) => [cityLabel(n), tag(n.dept), h('div', { class: 'small' }, text(n.content)), when(n.ts)]), 'No KPI notes.'))),
    h('div', { class: 'card section' }, h('h3', {}, `Notes (${shown.length})`),
      ctx.table(['When', 'City', 'Dept', 'Agent', 'Kind', 'Note'],
        shown.slice(0, 300).map((n) => [
          when(n.ts),
          cityLabel(n),
          tag(n.dept),
          tag(n.agent),
          n.untagged?.length ? ctx.statusChip('warning', n.kind ?? 'no kind') : h('span', { class: 'chip' }, KIND_LABEL[n.kind] ?? n.kind),
          h('div', { class: 'small surface-text' }, text(n.content)),
        ]),
        'Nothing matches these filters.'),
      shown.length > 300 ? h('p', { class: 'small muted' }, 'Showing the newest 300. Narrow the filters to see more.') : null),
  ];
}
