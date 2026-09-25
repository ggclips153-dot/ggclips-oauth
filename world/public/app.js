// World dashboard. Reads the world EVENT LEDGER's projection (/api/state) and follows it live
// (/api/stream). It never owns state. Every string from the ledger is inserted as text, never HTML.

// ---------- tiny DOM helpers (no innerHTML anywhere) ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
function build(el, attrs, kids) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}
const h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);
const s = (tag, attrs, ...kids) => build(document.createElementNS(SVG_NS, tag), attrs, kids);

// ---------- constants ----------
const FAMILIES = [
  ['revenue', 'Revenue'],
  ['claude', 'Claude'],
  ['gemini', 'Gemini'],
  ['essentials', 'Essentials'],
];
const STATES = ['enrolled', 'student', 'probationer', 'active', 'senior'];
const STAGES = [
  ['enrollment', 'Enrolled'],
  ['school', 'School'],
  ['graduation', 'Graduated'],
  ['active', 'Active'],
  ['promotion', 'Promoted'],
  ['school-return', 'Back to school'],
  ['3rd-strike', '3rd strike'],
  ['deletion', 'Deleted'],
];
const BAD_STAGES = new Set(['school-return', '3rd-strike', 'deletion']);
const JAIL_CAUSE = { kpi_strikes: 'KPI strikes', task_strikes: 'Task strikes', teaching_strikes: 'Teaching strikes' };
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------- app state ----------
const app = document.getElementById('app');
let me = null;
let data = null;
let clockSkew = 0; // server now - client now
let live = 'connecting';
let stream = null;
const feed = [];
let refreshTimer = null;

const serverNow = () => Date.now() + clockSkew;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-world-request': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    me = null;
    showLogin();
    throw new Error('signed out');
  }
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json;
}

// ---------- boot ----------
async function boot() {
  me = (await api('/api/session')).profile;
  if (!me) return showLogin();
  await refresh();
  const events = await api(`/api/events?after=${Math.max(0, data.lastSeq - 25)}`);
  feed.push(...events.events.reverse());
  connect();
  render();
  setInterval(render, 30_000); // countdowns
  setInterval(refresh, 60_000); // timed jail releases, belt-and-braces
}

async function refresh() {
  const main = document.querySelector('main');
  main?.classList.add('refreshing');
  try {
    data = await api('/api/state');
    clockSkew = Date.parse(data.now) - Date.now();
  } finally {
    main?.classList.remove('refreshing');
  }
  render();
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 250);
}

function connect() {
  stream?.close();
  stream = new EventSource('/api/stream');
  stream.onopen = () => setLive('on');
  stream.onerror = () => setLive('off');
  stream.addEventListener('ledger', (msg) => {
    const e = JSON.parse(msg.data);
    feed.unshift(e);
    feed.length = Math.min(feed.length, 40);
    scheduleRefresh();
  });
}

function setLive(v) {
  live = v;
  const el = document.querySelector('.live');
  if (el) {
    el.className = `live ${v}`;
    el.lastChild.textContent = v === 'on' ? 'Live' : 'Reconnecting…';
  }
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

// ---------- login ----------
function showLogin() {
  stream?.close();
  const error = h('p', { class: 'error', role: 'alert' });
  const user = h('input', { name: 'username', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const form = h(
    'form',
    {
      class: 'card',
      onsubmit: async (ev) => {
        ev.preventDefault();
        error.textContent = '';
        try {
          me = await api('/api/login', { method: 'POST', body: { username: user.value, password: pass.value } });
          boot();
        } catch (err) {
          error.textContent = err.message;
          pass.value = '';
        }
      },
    },
    h('div', { class: 'brand' }, globe(), 'World'),
    h('p', { class: 'secondary small' }, 'Sign in to the world dashboard.'),
    h('label', {}, 'Username', user),
    h('label', {}, 'Password', pass),
    error,
    h('button', { class: 'primary', type: 'submit' }, 'Sign in'),
  );
  app.replaceChildren(h('div', { class: 'login' }, form));
}

async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  me = null;
  showLogin();
}

// ---------- lookups ----------
function index() {
  const cities = new Map();
  const agents = new Map();
  const depts = new Map();
  for (const c of data.cities) {
    cities.set(c.id, c);
    for (const d of c.districts) {
      for (const dp of d.departments) {
        depts.set(dp.id, dp);
        for (const a of dp.agents) agents.set(a.id, { ...a, cityId: c.id });
      }
    }
    for (const a of c.college.enrolled) agents.set(a.id, { ...a, cityId: c.id });
    for (const a of c.college.professors) agents.set(a.id, { ...a, cityId: c.id });
    if (c.college.dean) agents.set(c.college.dean.id, { ...c.college.dean, cityId: c.id });
  }
  return { cities, agents, depts };
}

const agentLabel = (ix, id) => {
  const a = ix.agents.get(id);
  return a ? `${a.name} (${id})` : id;
};

// ---------- time ----------
function ago(ts) {
  const m = Math.round((serverNow() - Date.parse(ts)) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const hrs = Math.round(m / 60);
  return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}
function until(ts) {
  const m = Math.max(0, Math.round((Date.parse(ts) - serverNow()) / 60_000));
  const d = Math.floor(m / 1440);
  const hr = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${hr}h left` : hr ? `${hr}h ${m % 60}m left` : `${m}m left`;
}

// ---------- small components ----------
function globe() {
  return s('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true' },
    s('circle', { cx: 16, cy: 16, r: 13, fill: 'none', stroke: 'currentColor', 'stroke-width': 3 }),
    s('path', { d: 'M3 16h26M16 3c-5 4-5 22 0 26M16 3c5 4 5 22 0 26', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }));
}

/** Status chip: color never alone - always an icon and a label. */
function statusChip(kind, label) {
  const icons = {
    good: 'M3 8.5l3 3 7-7',
    warning: 'M8 2l6.5 12h-13zM8 6.5v3.5M8 12v.5',
    serious: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 4.5v4.5M8 11v.5',
    critical: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM5.5 5.5l5 5M10.5 5.5l-5 5',
  };
  return h('span', { class: `chip ${kind}` },
    s('svg', { class: 'icon', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      s('path', { d: icons[kind], fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
    label);
}

const badge = (text) => h('span', { class: 'chip badge' }, text);

function familyMark(family) {
  const label = (FAMILIES.find(([k]) => k === family) ?? [family, family])[1];
  return h('span', { class: 'chip' }, h('span', { class: `swatch fam-${family}`, 'aria-hidden': 'true' }), label);
}

/** Sparkline: de-emphasis line, accent end-dot, hairline target. Values are in the table view. */
function sparkline(pulses, { large = false } = {}) {
  const values = pulses.map((p) => p.value);
  const target = pulses.at(-1)?.target ?? null;
  const W = large ? 600 : 110;
  const H = large ? 64 : 32;
  const pad = 5;
  const max = Math.max(...values, target ?? 0, 1);
  const x = (i) => (values.length < 2 ? W / 2 : pad + (i * (W - 2 * pad)) / (values.length - 1));
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const svg = s('svg', {
    class: `spark${large ? ' large' : ''}`,
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': `${pulses.at(-1)?.metric ?? 'KPI'}: last ${values.length} pulses, latest ${values.at(-1)}`,
  });
  if (target !== null) svg.append(s('line', { class: 'target', x1: 0, x2: W, y1: y(target), y2: y(target), 'vector-effect': 'non-scaling-stroke' }));
  if (values.length > 1) svg.append(s('polyline', { class: 'line', points: pts, 'vector-effect': 'non-scaling-stroke' }));
  if (large) {
    // Per-point hover targets (bigger than the mark), each with its value.
    pulses.forEach((p, i) => svg.append(s('circle', { cx: x(i), cy: y(p.value), r: 10, fill: 'transparent' },
      s('title', {}, `${p.periodStart}: ${whole.format(p.value)}${p.target != null ? ` (target ${whole.format(p.target)})` : ''}`))));
  }
  if (values.length) svg.append(s('circle', { class: 'end', cx: x(values.length - 1), cy: y(values.at(-1)), r: 4 }));
  return svg;
}

function kpiStatus(kpi) {
  if (kpi.target == null) return null;
  return kpi.value >= kpi.target ? statusChip('good', 'On target') : statusChip('critical', 'Below target');
}

/** Agent counts by state: one stacked bar (ordinal ramp, 2px surface gaps) + a legend that carries every number. */
function stateBar(counts) {
  const total = STATES.reduce((n, st) => n + (counts[st] ?? 0), 0);
  const W = 300;
  const svg = s('svg', { class: 'statebar', viewBox: `0 0 ${W} 10`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${total} agents by state` });
  svg.append(s('rect', { class: 'track', x: 0, y: 0, width: W, height: 10, rx: 3 }));
  if (total) {
    const live = STATES.filter((st) => counts[st]);
    const gaps = (live.length - 1) * 2;
    let x = 0;
    STATES.forEach((st, i) => {
      const n = counts[st] ?? 0;
      if (!n) return;
      const w = ((W - gaps) * n) / total;
      svg.append(s('rect', { class: `st-${i}`, x, y: 0, width: Math.max(w, 1), height: 10, rx: 2 }, s('title', {}, `${cap(st)}: ${n}`)));
      x += w + 2;
    });
  }
  const legend = h('div', { class: 'legend' },
    STATES.map((st, i) => h('span', {}, h('span', { class: `swatch st-${i}`, 'aria-hidden': 'true' }), cap(st), ' ', h('b', { class: 'num' }, counts[st] ?? 0))));
  return h('div', {}, svg, legend);
}

function lifecycleStrip(agent) {
  const reached = new Set(agent.lifecycle.map((l) => l.stage));
  const current = agent.lifecycle.at(-1)?.stage;
  const when = (stage) => agent.lifecycle.filter((l) => l.stage === stage).at(-1)?.ts;
  return h('div', { role: 'img', 'aria-label': `Lifecycle: ${STAGES.filter(([k]) => reached.has(k)).map(([, l]) => l).join(', ')}` },
    h('div', { class: 'strip' },
      STAGES.map(([k, label]) => h('span', {
        class: [reached.has(k) && 'reached', k === current && 'current', BAD_STAGES.has(k) && 'bad'].filter(Boolean).join(' '),
        title: reached.has(k) ? `${label}: ${new Date(when(k)).toLocaleString()}` : label,
      }))),
    h('div', { class: 'strip-labels' }, h('span', {}, 'Enrolled'), h('span', {}, 'Active'), h('span', {}, 'Deleted')));
}

function stat(label, value, sub) {
  return h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub && h('div', { class: 'sub' }, sub));
}

function table(headers, rows, empty = 'Nothing here yet.') {
  if (!rows.length) return h('p', { class: 'muted small' }, empty);
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', { class: x.num ? 'num' : null }, x.label ?? x)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: headers[i]?.num ? 'num' : null }, c)))))));
}

// ---------- chrome ----------
function topbar() {
  const route = location.hash || '#/';
  const link = (href, label, count, alert) =>
    h('a', { href, 'aria-current': route === href || (href !== '#/' && route.startsWith(href)) ? 'page' : null },
      label, count != null && h('span', { class: `count-pill${alert && count ? ' alert' : ''}` }, count));
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, globe(), 'World'),
    h('nav', { class: 'nav', 'aria-label': 'Sections' },
      link('#/', 'Map'),
      link('#/jail', 'Jail', data.jail.length, true),
      link('#/inbox', 'Inbox', data.escalations.length, true),
      link('#/activity', 'Activity')),
    h('span', { class: 'spacer' }),
    h('span', { class: `live ${live}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }), live === 'on' ? 'Live' : 'Reconnecting…'),
    h('span', { class: 'user' }, `${me.label ?? me.id} · ${me.role === 'owner' ? 'Owner' : cap(me.role)}`),
    h('button', { onclick: logout }, 'Sign out'));
}

function render() {
  if (!me || !data) return;
  const route = (location.hash || '#/').slice(1);
  const ix = index();
  let view;
  if (route.startsWith('/city/')) view = cityView(ix, decodeURIComponent(route.slice(6)));
  else if (route === '/jail') view = jailView(ix);
  else if (route === '/inbox') view = inboxView(ix);
  else if (route === '/activity') view = activityView(ix);
  else view = mapView(ix);
  app.replaceChildren(topbar(), h('main', {}, view));
}

// ---------- views ----------
function mapView(ix) {
  const totals = Object.fromEntries(STATES.map((st) => [st, data.cities.reduce((n, c) => n + (c.agentCounts[st] ?? 0), 0)]));
  const working = totals.probationer + totals.active + totals.senior;
  const kpis = h('div', { class: 'kpi-row' },
    stat('Cities', whole.format(data.cities.length)),
    stat('Agents working', whole.format(working), 'probationer, active or senior'),
    stat('In school', whole.format(totals.enrolled + totals.student), 'enrolled or student'),
    stat('In jail', whole.format(data.jail.length)),
    stat('Awaiting the DM', whole.format(data.pendingIntents.length), 'your requests not yet routed'),
    stat('Inbox', whole.format(data.escalations.length), 'escalated by Security'));

  const homes = FAMILIES.map(([fam, label]) => {
    const cities = data.cities.filter((c) => c.family === fam);
    return h('section', { class: 'family', 'aria-labelledby': `fam-${fam}` },
      h('div', { class: 'family-head' },
        h('span', { class: `swatch fam-${fam}`, 'aria-hidden': 'true' }),
        h('h2', { id: `fam-${fam}` }, label),
        h('span', { class: 'muted small' }, `${cities.length} ${cities.length === 1 ? 'city' : 'cities'}`)),
      cities.length ? h('div', { class: 'tiles' }, cities.map(cityTile)) : h('div', { class: 'empty' }, `No ${label} cities yet.`));
  });

  return [h('h1', {}, 'World map'), kpis, h('div', { class: 'map' }, homes)];
}

function cityTile(c) {
  const kpi = c.kpi;
  return h('a', { class: 'tile', href: `#/city/${encodeURIComponent(c.id)}`, 'aria-label': `${c.name}, Mayor ${c.mayorName}` },
    h('div', { class: 'tile-head' },
      h('div', {}, h('div', { class: 'tile-name' }, c.name), h('div', { class: 'small secondary' }, `Mayor ${c.mayorName}`)),
      c.jailedCount ? statusChip('critical', `${c.jailedCount} in jail`) : null),
    kpi
      ? h('div', { class: 'pulse' },
          h('div', {},
            h('div', { class: 'metric' }, kpi.metric.replaceAll('_', ' '), ` · ${kpi.period}`),
            h('div', { class: 'value' }, compact.format(kpi.value), kpi.target != null && h('span', { class: 'small muted' }, ` / ${compact.format(kpi.target)}`)),
            kpiStatus(kpi)),
          sparkline(c.kpiHistory.slice(-12)))
      : h('div', { class: 'small muted' }, 'No KPI pulse yet'),
    stateBar(c.agentCounts));
}

function cityView(ix, id) {
  const c = ix.cities.get(id);
  if (!c) return [h('p', {}, 'City not found. ', h('a', { href: '#/' }, 'Back to the map'))];
  const deptName = (dId) => ix.depts.get(dId)?.name ?? dId ?? '—';

  const head = h('div', { class: 'section' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'World map'), ' / ', c.name),
    h('div', { class: 'city-head' }, h('h1', {}, c.name), familyMark(c.family), h('span', { class: 'secondary' }, `Mayor ${c.mayorName}`),
      c.jailedCount ? statusChip('critical', `${c.jailedCount} in jail`) : null));

  const kpiCard = h('div', { class: 'card section' }, h('h3', {}, 'KPI pulse'),
    c.kpi
      ? [
          h('div', { class: 'stat' },
            h('div', { class: 'label' }, `${c.kpi.metric.replaceAll('_', ' ')} · ${c.kpi.period} from ${c.kpi.periodStart}`),
            h('div', { class: 'value' }, whole.format(c.kpi.value), c.kpi.target != null && h('span', { class: 'small muted' }, ` of ${whole.format(c.kpi.target)} target`)),
            kpiStatus(c.kpi),
            c.kpi.secondaryMetric && h('div', { class: 'sub' }, `${c.kpi.secondaryMetric.replaceAll('_', ' ')}: ${whole.format(c.kpi.secondaryValue)}`)),
          c.kpiHistory.length > 1 && sparkline(c.kpiHistory.slice(-24), { large: true }),
          h('details', {}, h('summary', { class: 'small' }, 'Table view'),
            table(['Period start', 'Period', { label: 'Value', num: true }, { label: 'Target', num: true }],
              c.kpiHistory.slice(-24).reverse().map((p) => [p.periodStart, p.period, whole.format(p.value), p.target == null ? '—' : whole.format(p.target)]))),
        ]
      : h('p', { class: 'muted small' }, 'The Mayor has not written a KPI pulse yet.'));

  const agentsCard = h('div', { class: 'card section' }, h('h3', {}, 'Agents by state'), stateBar(c.agentCounts),
    c.lastHealthReport && h('div', { class: 'small' }, h('h4', {}, `Health report · week of ${c.lastHealthReport.weekOf}`), h('p', { class: 'secondary' }, c.lastHealthReport.summary)));

  return [head, h('div', { class: 'two-col' }, kpiCard, agentsCard), collegeSection(ix, c, deptName), ...c.districts.map((d) => districtSection(ix, d)),
    reportsSection(ix, c), retiredSection(c)];
}

function collegeSection(ix, c, deptName) {
  const dean = c.college.dean;
  const deanCard = h('div', { class: 'card section' }, h('h3', {}, 'Dean'),
    dean
      ? [
          h('div', {}, h('b', {}, dean.name), ' ', h('span', { class: 'mono muted' }, dean.id), h('span', { class: 'small muted' }, ` · since ${new Date(dean.since).toLocaleDateString()}`)),
          h('div', { class: 'kpi-row' },
            miniStat('Graduates', dean.scorecard.graduates),
            miniStat('Still working', dean.scorecard.stillWorking),
            miniStat('Past probation', dean.scorecard.promotedPastProbation),
            miniStat('KPI strikes', dean.scorecard.kpiStrikes),
            miniStat('Deleted', dean.scorecard.deleted)),
          dean.reviews.length
            ? h('p', { class: 'small' }, 'Latest Mayor review: ', h('b', {}, cap(dean.reviews.at(-1).rating)), ` — ${dean.reviews.at(-1).notes}`)
            : h('p', { class: 'small muted' }, 'No Mayor review yet.'),
        ]
      : h('p', { class: 'muted small' }, 'No dean yet.'));

  const profs = table(
    ['Professor', 'Specialty', { label: 'Exams', num: true }, { label: 'Passed', num: true }, { label: 'Graduates', num: true }, { label: 'Teaching strikes', num: true }, 'Now'],
    c.college.professors.map((p) => [
      h('div', {}, p.name, h('div', { class: 'mono muted' }, p.id)),
      deptName(p.specialtyDepartmentId),
      p.teaching?.examsGiven ?? 0,
      p.teaching?.examsPassed ?? 0,
      p.teaching?.graduates ?? 0,
      `${p.strikes} / 3`,
      p.jail ? jailChip(p) : p.steppedIn ? badge(`In ${deptName(p.steppedIn.departmentId)}: ${p.steppedIn.role} (${until(p.steppedIn.until)})`) : 'Teaching',
    ]),
    'No professors yet.');

  const waiting = table(['New agent', 'Domain focus', 'Created'],
    c.college.enrolled.map((a) => [h('div', {}, a.name, h('div', { class: 'mono muted' }, a.id)), a.domainFocus, ago(a.lifecycle[0].ts)]),
    'No new agents waiting for a department.');

  return h('section', { class: 'card section', 'aria-labelledby': `college-${c.id}` },
    h('h2', { id: `college-${c.id}` }, 'College'),
    h('div', { class: 'two-col' }, deanCard, h('div', { class: 'card section' }, h('h3', {}, 'Waiting for a department'), waiting)),
    h('h3', {}, 'Professors'), profs);
}

const miniStat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, whole.format(value)));

function jailChip(a) {
  if (!a.jail) return null;
  if (a.jail.status === 'awaiting_deletion') return statusChip('critical', 'Jail · awaiting deletion');
  if (Date.parse(a.jail.until) <= serverNow()) return null;
  return statusChip('serious', `Jail · ${until(a.jail.until)}`);
}

function districtSection(ix, d) {
  return h('section', { class: 'card section', 'aria-labelledby': `d-${d.id}` },
    h('div', {}, h('h2', { id: `d-${d.id}` }, d.name), h('span', { class: 'small secondary' }, `District · supervisor ${d.supervisor} · `), h('span', { class: 'mono muted' }, d.id)),
    d.departments.length ? d.departments.map((dp) => departmentCard(ix, dp)) : h('p', { class: 'muted small' }, 'No departments yet.'));
}

function departmentCard(ix, dp) {
  const capText = (n, max) => (max == null ? `${n}` : `${n} / ${max}`);
  const rows = dp.agents.map((a) => [
    h('div', {}, a.name, h('div', { class: 'mono muted' }, a.id)),
    h('div', { class: 'dept-meta' }, badge(cap(a.state)), a.badges.map((b) => badge(b === 'intern' ? 'Shadow (intern)' : b))),
    a.status
      ? h('div', {}, h('b', {}, cap(a.status.status)), a.status.activity && h('div', { class: 'small secondary' }, a.status.activity), h('div', { class: 'small muted' }, ago(a.status.ts)))
      : h('span', { class: 'muted' }, '—'),
    h('div', { class: 'small' }, `KPI ${a.strikes}/3 · Task ${a.taskStrikes}/3`, h('div', {}, jailChip(a))),
    lifecycleStrip(a),
  ]);
  return h('div', { class: 'dept' },
    h('div', {}, h('h3', {}, dp.name), h('p', { class: 'small secondary' }, dp.scope)),
    h('div', { class: 'dept-meta' },
      badge(`Graduated ${capText(dp.graduatedCount, dp.maxGraduated)}`),
      badge(`Shadows ${capText(dp.shadowCount, dp.maxShadows)}`),
      badge(`${dp.basicTasks.length} basic task${dp.basicTasks.length === 1 ? '' : 's'}`),
      dp.openRoleRequests.length ? statusChip('warning', `${dp.openRoleRequests.length} unfilled role${dp.openRoleRequests.length === 1 ? '' : 's'}`) : null,
      dp.professors.filter((p) => p.steppedIn?.departmentId === dp.id).map((p) => badge(`Professor ${p.name} stepping in`))),
    table(['Agent', 'State', 'Live status', 'Strikes', 'Lifecycle'], rows, 'No agents in this department yet.'),
    dp.openDelegations.length
      ? h('details', {}, h('summary', { class: 'small' }, `${dp.openDelegations.length} open delegated task${dp.openDelegations.length === 1 ? '' : 's'}`),
          table(['Task', 'From', 'To', 'Given'], dp.openDelegations.map((t) => [t.task, agentLabel(ix, t.fromAgentId), agentLabel(ix, t.toAgentId), ago(t.ts)])))
      : null);
}

function reportsSection(ix, c) {
  if (!c.deanReports.length) return null;
  return h('section', { class: 'card section' }, h('h2', {}, 'Dean reports'),
    table(['When', 'Agent', 'Reason', 'Security'],
      c.deanReports.slice().reverse().map((r) => [ago(r.ts), agentLabel(ix, r.agentId), r.reason, r.escalated ? statusChip('serious', 'Escalated to Marc') : 'With Security'])));
}

function retiredSection(c) {
  if (!c.retired.length) return null;
  return h('section', { class: 'card section' }, h('h2', {}, 'Deleted agents'), h('p', { class: 'small secondary' }, 'IDs and names are retired forever. Ledgers are frozen and archived; only the lesson record carries on.'),
    table(['Agent', 'Deleted', 'Lesson record'], c.retired.map((a) => [h('div', {}, a.name, h('div', { class: 'mono muted' }, a.id)), ago(a.deleted.ts), h('span', { class: 'mono' }, a.deleted.lessonRecordRef)])));
}

function jailView(ix) {
  const cityName = (id) => ix.cities.get(id)?.name ?? id;
  const rows = data.jail.map((j) => [
    h('div', {}, j.name, h('div', { class: 'mono muted' }, j.id)),
    h('a', { href: `#/city/${encodeURIComponent(j.cityId)}` }, cityName(j.cityId)),
    JAIL_CAUSE[j.jail.cause] ?? j.jail.cause,
    j.jail.term ?? '—',
    j.jail.status === 'awaiting_deletion' ? statusChip('critical', 'Awaiting your deletion decision') : statusChip('serious', until(j.jail.until)),
  ]);
  const strikes = data.taskStrikes.slice(-20).reverse().map((t) => [ago(t.ts), agentLabel(ix, t.agentId), cityName(t.agentCity), t.task, agentLabel(ix, t.observedBy)]);
  return [
    h('h1', {}, 'Security jail'),
    h('p', { class: 'secondary' }, 'Every 3 task strikes means a jail term: 6 hours, then 24 hours, then 3 days. The 4th time, or a 3rd KPI or teaching strike, the agent waits here for your deletion decision. Timed terms end on their own.'),
    h('div', { class: 'card' }, table(['Agent', 'City', 'Cause', { label: 'Term', num: true }, 'Release'], rows, 'Nobody is in jail.')),
    h('div', { class: 'card section' }, h('h2', {}, 'Recent task strikes'), table(['When', 'Agent', 'City', 'Task', 'Observed by'], strikes, 'No task strikes recorded.')),
  ];
}

function inboxView(ix) {
  const cityName = (id) => ix.cities.get(id)?.name ?? id;
  return [
    h('h1', {}, 'Inbox'),
    h('p', { class: 'secondary' }, 'Dean reports that Security has brought up to you. You decide what happens next.'),
    h('div', { class: 'card' },
      table(['Escalated', 'City', 'Agent', "Dean's reason", 'Security summary'],
        data.escalations.slice().reverse().map((r) => [ago(r.escalated.ts), cityName(r.cityId), agentLabel(ix, r.agentId), r.reason, r.escalated.summary]),
        'Nothing escalated. All quiet.')),
  ];
}

function describe(ix, e) {
  const who = e.subject ? agentLabel(ix, e.subject) : '';
  const city = ix.cities.get(e.city)?.name ?? (e.city === 'WORLD' ? 'World' : e.city);
  const words = e.type.replace(/^intent\./, 'request: ').replaceAll('_', ' ').replaceAll('.', ' ');
  return `${city} · ${words}${who ? ` · ${who}` : ''}`;
}

function activityView(ix) {
  return [
    h('h1', {}, 'Live activity'),
    h('p', { class: 'secondary' }, 'The latest events from the world ledger, newest first.'),
    h('div', { class: 'card' },
      feed.length
        ? h('div', { class: 'feed' }, feed.map((e) => h('div', {}, h('span', { class: 'mono muted' }, `#${e.seq}`), h('span', {}, describe(ix, e), h('span', { class: 'muted' }, ` · ${ago(e.ts)}`)))))
        : h('p', { class: 'muted small' }, 'No events yet.')),
  ];
}

boot().catch(() => {});
