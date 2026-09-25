// The 3D world: a globe you use like Google Maps. The same ledger projection as the 2D map.
//   Continents: one per family (Revenue the largest; Essentials; Claude and Gemini one-city islands).
//   Cities: map pins. Zoom in and a city appears on the surface: its platform, a building per department
//   (taller = more agents), the college dome and professors, the KPI beacon, agents coloured by state
//   (working agents walk), and Security's jail.
//   Drag to spin, scroll or pinch to zoom toward the cursor, double-click to fly in, +/- and reset,
//   search to fly to a city, click a pin for its card.
import * as THREE from './vendor/three-r186/three.module.min.js';
import { OrbitControls } from './vendor/three-r186/OrbitControls.min.js';
import { h } from './dom.js';

const R = 50; // globe radius
const DEG = Math.PI / 180;
const FAMILY_ORDER = ['revenue', 'essentials', 'claude', 'gemini'];
const FAMILY_LABEL = { revenue: 'Revenue', claude: 'Claude', gemini: 'Gemini', essentials: 'Essentials' };
/** Continents: centre (lat, lon) and angular radius. Revenue gets the room; Claude and Gemini hold one city each. */
const CONTINENTS = {
  revenue: { lat: 8, lon: 12, rad: 58 },
  essentials: { lat: 34, lon: 128, rad: 30 },
  claude: { lat: -36, lon: -112, rad: 13 },
  gemini: { lat: 36, lon: -96, rad: 13 },
};
const STATES = ['enrolled', 'student', 'probationer', 'active', 'senior'];
const PLATFORM = 8;
const CITY_SCALE = 0.3; // city detail model units -> globe units
const DETAIL_DISTANCE = 22; // camera closer than this to a city shows its detail
const HOME_DIST = R * 3.3;

const HOME_LATLON = { lat: 22, lon: 30 }; // faces the Revenue continent

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function palette() {
  return {
    surface: css('--surface'),
    surface2: css('--surface-2'),
    ink: css('--ink'),
    axis: css('--axis'),
    deemph: css('--deemph'),
    good: css('--good'),
    critical: css('--critical'),
    serious: css('--serious'),
    family: Object.fromEntries(FAMILY_ORDER.map((f) => [f, css(`--fam-${f}`)])),
    state: STATES.map((_, i) => css(`--st-${i}`)),
  };
}

/** Unit vector for latitude/longitude (degrees). */
function dirOf(lat, lon) {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
}

/** The point `dist` degrees from (lat, lon) along `bearing` degrees. */
function destination(lat, lon, bearing, dist) {
  const [p1, l1, b, d] = [lat * DEG, lon * DEG, bearing * DEG, dist * DEG];
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / DEG, lon: ((l2 / DEG + 540) % 360) - 180 };
}

const HOME_DIR = dirOf(HOME_LATLON.lat, HOME_LATLON.lon);

/** City spots inside a family's continent: a sunflower spiral, so any number of cities spreads evenly. */
function citySpots(family, n) {
  const c = CONTINENTS[family];
  if (n === 1) return [{ lat: c.lat, lon: c.lon }];
  return Array.from({ length: n }, (_, k) => destination(c.lat, c.lon, k * 137.508, c.rad * 0.72 * Math.sqrt((k + 0.5) / n)));
}

/** Wobbly coastline noise, from latitude/longitude in radians. */
const coastNoise = (la, lo) => 0.5 * Math.sin(3 * lo + 2.1 * Math.sin(2 * la)) + 0.3 * Math.sin(7 * la + 5 * lo) + 0.2 * Math.sin(13 * lo - 11 * la);

let textureCache = null;
let texturePending = null;

/**
 * Equirectangular Earth-style texture: oceans, one continent per family, a faint graticule.
 * Painted in small time slices between frames so the page never freezes; resolves when done.
 */
function earthTexture(pal) {
  const key = JSON.stringify(pal.family);
  if (textureCache?.key === key) return Promise.resolve(textureCache.texture);
  if (texturePending?.key === key) return texturePending.promise;
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const rgb = (c) => {
    const x = new THREE.Color(c);
    return [x.r * 255, x.g * 255, x.b * 255];
  };
  const sand = rgb('#e7e0c4');
  const conts = FAMILY_ORDER.map((f) => {
    const c = CONTINENTS[f];
    const la = c.lat * DEG;
    const lo = c.lon * DEG;
    return { sinLa: Math.sin(la), cosLa: Math.cos(la), cosLo: Math.cos(lo), sinLo: Math.sin(lo), rad: c.rad * DEG, col: rgb(pal.family[f]) };
  });
  // Per-column longitude terms, computed once.
  const lons = new Float64Array(W);
  const cosLons = new Float64Array(W);
  const sinLons = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    lons[x] = ((x / W) * 360 - 180) * DEG;
    cosLons[x] = Math.cos(lons[x]);
    sinLons[x] = Math.sin(lons[x]);
  }

  const paintRow = (y) => {
    const la = (90 - (y / H) * 180) * DEG;
    const sinLa = Math.sin(la);
    const cosLa = Math.cos(la);
    const gridRow = Math.abs(((y / H) * 180) % 15) < 0.18;
    for (let x = 0; x < W; x++) {
      // The continent whose (noisy) coastline this pixel is nearest to or inside.
      const n = coastNoise(la, lons[x]);
      let best = conts[0];
      let edge = Infinity;
      for (const c of conts) {
        const cosD = sinLa * c.sinLa + cosLa * c.cosLa * (cosLons[x] * c.cosLo + sinLons[x] * c.sinLo);
        const e = Math.acos(clamp(cosD, -1, 1)) - c.rad * (1 + 0.16 * n);
        if (e < edge) {
          edge = e;
          best = c;
        }
      }
      const i = (y * W + x) * 4;
      let r;
      let g;
      let b;
      if (edge < 0) {
        const shade = 0.86 + 0.14 * coastNoise(la * 3.1, lons[x] * 2.7);
        const t = 0.58 + (edge > -0.018 ? 0.15 : 0);
        r = (best.col[0] * (1 - t) + sand[0] * t) * shade;
        g = (best.col[1] * (1 - t) + sand[1] * t) * shade;
        b = (best.col[2] * (1 - t) + sand[2] * t) * shade;
      } else {
        const shallow = clamp(1 - edge / 0.09, 0, 1) ** 2;
        r = 8 + 26 * shallow;
        g = 22 + 58 * shallow;
        b = 48 + 78 * shallow;
      }
      if (gridRow || Math.abs(((x / W) * 360) % 15) < 0.18) {
        r = r * 0.85 + 38;
        g = g * 0.85 + 38;
        b = b * 0.85 + 38;
      }
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  };

  const promise = new Promise((resolve) => {
    let y = 0;
    const slice = () => {
      const until = performance.now() + 12;
      while (y < H && performance.now() < until) paintRow(y++);
      if (y < H) return setTimeout(slice, 0);
      ctx.putImageData(img, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      textureCache = { key, texture };
      texturePending = null;
      resolve(texture);
    };
    slice();
  });
  texturePending = { key, promise };
  return promise;
}

/** Warm up while the dashboard is idle: paint the globe texture in the background. */
export function prewarm() {
  return earthTexture(palette());
}

export function mount3D(container, { onOpenCity }) {
  container.classList.add('w3d-globe');
  const canvasHost = h('div', { class: 'w3d-canvas', role: 'img', 'aria-label': 'Globe view of the world. Use the Map view for a readable list.' });
  const labels = h('div', { class: 'w3d-labels', 'aria-hidden': 'true' });
  const tip = h('div', { class: 'w3d-tip', role: 'status' });
  const card = h('div', { class: 'w3d-card', hidden: true });
  const search = h('input', { class: 'w3d-search', type: 'search', placeholder: 'Search cities', 'aria-label': 'Search cities', list: 'w3d-cities', autocomplete: 'off' });
  const datalist = h('datalist', { id: 'w3d-cities' });
  const zoomIn = h('button', { type: 'button', class: 'w3d-btn', 'aria-label': 'Zoom in', onclick: () => zoomBy(0.6) }, '+');
  const zoomOut = h('button', { type: 'button', class: 'w3d-btn', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 0.6) }, '−');
  const home = h('button', { type: 'button', class: 'w3d-btn', 'aria-label': 'Reset view', title: 'Reset view', onclick: () => flyTo(HOME_DIR, HOME_DIST) }, '⌂');
  container.replaceChildren(
    canvasHost,
    labels,
    tip,
    h('div', { class: 'w3d-searchbox' }, search, datalist),
    card,
    h('div', { class: 'w3d-zoom' }, zoomIn, zoomOut, home),
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvasHost.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05070d');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
  camera.position.copy(HOME_DIR).multiplyScalar(HOME_DIST);
  scene.add(camera);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.zoomToCursor = true;
  controls.minDistance = R * 1.1;
  controls.maxDistance = R * 5;
  controls.target.set(0, 0, 0);

  // Light follows the camera (always daylight where you look), plus a soft fill.
  const headlight = new THREE.DirectionalLight(0xffffff, 2.2);
  headlight.position.set(0.4, 0.6, 1);
  camera.add(headlight);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));

  // Stars.
  const starGeo = new THREE.BufferGeometry();
  const stars = new Float32Array(3 * 1500);
  for (let i = 0; i < 1500; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(700 + Math.random() * 300);
    stars.set([v.x, v.y, v.z], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.7 })));

  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }));
  scene.add(globe);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x6fb3ff, transparent: true, opacity: 0.13, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  scene.add(atmosphere);

  let world = new THREE.Group();
  scene.add(world);
  let movers = [];
  let anchors = [];
  let pins = [];
  let details = [];
  let cityDirs = new Map();
  const pickables = [];
  let dataRef = null;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let downAt = null;
  let anim = null;

  function disposeWorld() {
    world.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    scene.remove(world);
    world = new THREE.Group();
    scene.add(world);
    movers = [];
    anchors = [];
    pins = [];
    details = [];
    cityDirs = new Map();
    pickables.length = 0;
    labels.replaceChildren();
  }

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...extra });
  const pick = (mesh, info) => {
    Object.assign(mesh.userData, info);
    pickables.push(mesh);
    return mesh;
  };
  /** A label that follows a point on the globe; hidden when on the far side or outside its zoom range. */
  const label = (text, sub, pos, cls, { minDist = 0, maxDist = Infinity } = {}) => {
    const el = h('div', { class: `w3d-label w3d-${cls}` }, h('b', {}, text), sub && h('span', {}, sub));
    labels.append(el);
    anchors.push({ el, pos, normal: pos.clone().normalize(), minDist, maxDist });
  };

  function figure(color, tipText, cityId) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), mat(color));
    body.position.y = 0.45;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat(color));
    head.position.y = 0.95;
    g.add(body, head);
    pick(body, { tip: tipText, cityId });
    pick(head, { tip: tipText, cityId });
    return g;
  }

  /** A city's model in local units (y up), as seen when zoomed in. */
  function cityModel(c, fam, pal, jailed, now) {
    const g = new THREE.Group();
    const inJail = (a) => a.jail && (a.jail.status === 'awaiting_deletion' || Date.parse(a.jail.until) > now);
    const kpiText = c.kpi ? `${c.kpi.metric.replaceAll('_', ' ')}: ${c.kpi.value}${c.kpi.target != null ? ` / ${c.kpi.target}` : ''}` : 'No KPI pulse yet';

    const platform = pick(new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM, PLATFORM + 0.6, 1.2, 6), mat(pal.surface)), { tip: `${c.name} · Mayor ${c.mayorName} · ${kpiText}`, cityId: c.id, city: true });
    platform.position.y = 0.6;
    g.add(platform);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(PLATFORM + 0.3, 0.18, 6, 6), mat(pal.family[fam]));
    rim.rotation.x = Math.PI / 2;
    rim.rotation.z = Math.PI / 6;
    rim.position.y = 1.2;
    g.add(rim);

    const dome = pick(new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(pal.axis)), {
      tip: `${c.name} college · dean ${c.college.dean?.name ?? 'not appointed'} · ${c.college.professors.length} professor(s) · ${c.college.enrolled.length} new agent(s) waiting`,
      cityId: c.id,
    });
    dome.position.y = 1.2;
    g.add(dome);
    c.college.professors.forEach((p, k) => {
      const prof = pick(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 10), mat(pal.ink)), { tip: `Professor ${p.name} (${p.id})${p.steppedIn ? ` · stepping in: ${p.steppedIn.role}` : ' · teaching'}`, cityId: c.id });
      const a = (k / Math.max(1, c.college.professors.length)) * Math.PI * 2;
      prof.position.set(Math.cos(a) * 2.3, 1.65, Math.sin(a) * 2.3);
      g.add(prof);
    });
    c.college.enrolled.forEach((a, k) => {
      const fig = figure(pal.state[0], `${a.name} (${a.id}) · enrolled at the college`, c.id);
      const ang = Math.PI / 4 + k * 0.5;
      fig.position.set(Math.cos(ang) * 3.1, 1.2, Math.sin(ang) * 3.1);
      g.add(fig);
    });

    const depts = c.districts.flatMap((d) => d.departments.map((dp) => ({ dp, d })));
    depts.forEach(({ dp, d }, k) => {
      const a = (k / Math.max(1, depts.length)) * Math.PI * 2 + Math.PI / 6;
      const pos = new THREE.Vector3(Math.cos(a) * 4.9, 0, Math.sin(a) * 4.9);
      const height = 1.2 + dp.graduatedCount * 0.9 + (dp.agents.length - dp.graduatedCount) * 0.3;
      const building = pick(new THREE.Mesh(new THREE.BoxGeometry(1.6, height, 1.6), mat(pal.surface2)), {
        tip: `${dp.name} (${d.name}) · ${dp.graduatedCount} working${dp.maxGraduated != null ? ` of ${dp.maxGraduated}` : ''} · ${dp.shadowCount} shadow(s) · ${dp.agents.length} total`,
        cityId: c.id,
      });
      building.position.set(pos.x, 1.2 + height / 2, pos.z);
      g.add(building);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 1.7), mat(pal.family[fam]));
      roof.position.set(pos.x, 1.2 + height + 0.09, pos.z);
      g.add(roof);
      if (dp.openRoleRequests.length) {
        const flag = pick(new THREE.Mesh(new THREE.OctahedronGeometry(0.35), mat(pal.serious, { emissive: pal.serious, emissiveIntensity: 0.4 })), { tip: `${dp.name}: ${dp.openRoleRequests.length} unfilled role(s)`, cityId: c.id });
        flag.position.set(pos.x, 1.2 + height + 0.8, pos.z);
        g.add(flag);
        movers.push({ obj: flag, spin: true });
      }
      dp.agents.forEach((ag, j) => {
        if (inJail(ag)) {
          jailed.push({ ag, city: c });
          return;
        }
        const status = ag.status?.status ?? 'idle';
        const fig = figure(pal.state[STATES.indexOf(ag.state)] ?? pal.deemph, `${ag.name} (${ag.id}) · ${ag.state}${ag.badges.length ? ` · ${ag.badges.join(', ')}` : ''} · ${status}${ag.status?.activity ? `: ${ag.status.activity}` : ''}`, c.id);
        const radius = 1.35 + (j % 3) * 0.25;
        const phase = (j / Math.max(1, dp.agents.length)) * Math.PI * 2;
        fig.position.set(pos.x + Math.cos(phase) * radius, 1.2, pos.z + Math.sin(phase) * radius);
        g.add(fig);
        if (status === 'working') movers.push({ obj: fig, center: pos, radius, phase, speed: 0.35 + (j % 4) * 0.07, y: 1.2 });
      });
    });

    const ratio = c.kpi && c.kpi.target ? Math.min(c.kpi.value / c.kpi.target, 1.5) : 0.25;
    const beaconH = 1.5 + ratio * 4;
    const onTarget = c.kpi && c.kpi.target != null && c.kpi.value >= c.kpi.target;
    const lampColor = c.kpi ? (onTarget ? pal.good : pal.critical) : pal.deemph;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, beaconH, 8), mat(pal.axis));
    pole.position.set(PLATFORM - 1.2, 1.2 + beaconH / 2, 0);
    g.add(pole);
    const lamp = pick(new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), mat(lampColor, { emissive: lampColor, emissiveIntensity: 0.6 })), {
      tip: `${c.name} KPI · ${kpiText}${c.kpi?.target != null ? (onTarget ? ' · on target' : ' · below target') : ''}`,
      cityId: c.id,
    });
    lamp.position.set(PLATFORM - 1.2, 1.2 + beaconH + 0.3, 0);
    g.add(lamp);
    return g;
  }

  function jailModel(pal, jailed) {
    const g = new THREE.Group();
    const cage = pick(new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 3.2), new THREE.MeshBasicMaterial({ color: pal.critical, wireframe: true })), { tip: `Security jail · ${jailed.length} inside`, cityId: 'security-city' });
    cage.position.set(-(PLATFORM - 2.4), 2.3, 0);
    g.add(cage);
    jailed.forEach(({ ag, city }, k) => {
      const until = ag.jail.status === 'awaiting_deletion' ? 'awaiting deletion' : `until ${new Date(ag.jail.until).toLocaleString()}`;
      const fig = figure(pal.critical, `${ag.name} (${ag.id}) of ${city.name} · in jail, ${until}`, 'security-city');
      fig.position.set(-(PLATFORM - 2.4) - 0.9 + (k % 3) * 0.9, 1.2, -0.9 + Math.floor(k / 3) * 0.9);
      g.add(fig);
    });
    return g;
  }

  /** Orient a group so its local +y is the globe's surface normal at `dir`. */
  const placeOnGlobe = (obj, dir, lift = 0) => {
    obj.position.copy(dir).multiplyScalar(R + lift);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  };

  function build(data) {
    dataRef = data;
    disposeWorld();
    const pal = palette();
    // Plain ocean at once; the continents fill in when the (sliced) painting finishes.
    if (!globe.material.map) globe.material.color.set('#0e2a48');
    earthTexture(pal).then((texture) => {
      if (globe.material.map === texture) return;
      globe.material.map = texture;
      globe.material.color.set('#ffffff');
      globe.material.needsUpdate = true;
    });

    const now = Date.parse(data.now);
    const jailed = [];
    let securityGroup = null;
    datalist.replaceChildren(...data.cities.map((c) => h('option', { value: c.name })));

    for (const fam of FAMILY_ORDER) {
      const cont = CONTINENTS[fam];
      const count = data.cities.filter((c) => c.family === fam).length;
      // Family name at the continent's southern edge, clear of its cities' labels.
      label(FAMILY_LABEL[fam], `${count} ${count === 1 ? 'city' : 'cities'}`, dirOf(cont.lat - cont.rad * 0.85, cont.lon).multiplyScalar(R * 1.01), 'family', { minDist: R * 1.9 });
      const cities = data.cities.filter((c) => c.family === fam);
      citySpots(fam, cities.length).forEach((spot, i) => {
        const c = cities[i];
        const dir = dirOf(spot.lat, spot.lon);
        cityDirs.set(c.id, dir);

        // Pin (kept a constant size on screen).
        const pin = new THREE.Group();
        const stem = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.2, 16), mat(pal.family[fam]));
        stem.rotation.x = Math.PI;
        stem.position.y = 1.1;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 16), mat(pal.family[fam], { emissive: pal.family[fam], emissiveIntensity: 0.25 }));
        head.position.y = 2.5;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        dot.position.y = 2.5;
        dot.position.z = 0.55;
        pin.add(stem, head, dot);
        for (const m of [stem, head, dot]) pick(m, { tip: `${c.name} · Mayor ${c.mayorName}`, cityId: c.id, city: true, pin: true });
        placeOnGlobe(pin, dir);
        world.add(pin);
        pins.push({ obj: pin, dir, cityId: c.id });

        // City detail, shown when zoomed in.
        const detail = cityModel(c, fam, pal, jailed, now);
        if (c.id === 'security-city') securityGroup = detail;
        detail.scale.setScalar(CITY_SCALE);
        placeOnGlobe(detail, dir, 0.02);
        detail.visible = false;
        world.add(detail);
        details.push({ obj: detail, dir });

        label(c.name, `Mayor ${c.mayorName}`, dir.clone().multiplyScalar(R), 'city', { maxDist: R * 4.2 });
      });
    }
    if (securityGroup) securityGroup.add(jailModel(pal, jailed));
  }

  // ---------- Google-Maps-style navigation ----------
  function flyTo(dir, dist, ms = reducedMotion() ? 0 : 900) {
    const fromDir = camera.position.clone().normalize();
    const fromDist = camera.position.length();
    anim = { fromDir, toDir: dir.clone().normalize(), fromDist, toDist: clamp(dist, controls.minDistance, controls.maxDistance), t0: performance.now(), ms };
    controls.enabled = false;
  }
  function zoomBy(f) {
    flyTo(camera.position.clone().normalize(), camera.position.length() * f, 400);
  }
  function stepAnim(t) {
    if (!anim) return;
    const k = anim.ms ? clamp((t - anim.t0) / anim.ms, 0, 1) : 1;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const dir = anim.fromDir.clone().lerp(anim.toDir, e).normalize();
    // Arc outward mid-flight when travelling far, like Google Earth.
    const hop = Math.sin(Math.PI * e) * anim.fromDir.distanceTo(anim.toDir) * R * 0.35;
    camera.position.copy(dir).multiplyScalar(anim.fromDist + (anim.toDist - anim.fromDist) * e + hop);
    camera.lookAt(0, 0, 0);
    if (k >= 1) {
      anim = null;
      controls.enabled = true;
    }
  }

  function showCard(cityId) {
    const c = dataRef?.cities.find((x) => x.id === cityId);
    if (!c) return;
    const agents = c.districts.flatMap((d) => d.departments.flatMap((dp) => dp.agents));
    const working = agents.filter((a) => a.status?.status === 'working').length;
    const kpi = c.kpi ? `${c.kpi.metric.replaceAll('_', ' ')}: ${c.kpi.value}${c.kpi.target != null ? ` of ${c.kpi.target}` : ''}` : 'No KPI pulse yet';
    card.replaceChildren(
      h('button', { type: 'button', class: 'w3d-card-close', 'aria-label': 'Close', onclick: () => (card.hidden = true) }, '×'),
      h('h3', {}, c.name),
      h('p', { class: 'small secondary' }, `${FAMILY_LABEL[c.family]} · Mayor ${c.mayorName}`),
      h('p', { class: 'small' }, kpi),
      h('p', { class: 'small secondary' }, `${agents.length} agent(s), ${working} working now · ${c.jailedCount} in jail`),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'small-btn primary', onclick: () => onOpenCity(c.id) }, 'Open city'),
        h('button', { type: 'button', class: 'small-btn', onclick: () => flyTo(cityDirs.get(c.id), R * 1.12) }, 'Zoom here')),
    );
    card.hidden = false;
  }

  search.addEventListener('change', () => {
    const q = search.value.trim().toLowerCase();
    const c = dataRef?.cities.find((x) => x.name.toLowerCase() === q) ?? dataRef?.cities.find((x) => x.name.toLowerCase().includes(q));
    if (!c) return;
    flyTo(cityDirs.get(c.id), R * 1.35);
    showCard(c.id);
    search.blur();
  });

  function setPointer(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const visible = pickables.filter((m) => {
      for (let o = m; o; o = o.parent) if (o.visible === false) return false;
      return true;
    });
    const hit = raycaster.intersectObjects([globe, ...visible], false)[0];
    hovered = hit && hit.object !== globe ? hit.object : null;
    if (hovered) {
      tip.textContent = hovered.userData.tip;
      tip.classList.add('on');
      tip.style.left = `${ev.clientX - r.left + 14}px`;
      tip.style.top = `${ev.clientY - r.top + 14}px`;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      tip.classList.remove('on');
      renderer.domElement.style.cursor = 'grab';
    }
    return hit;
  }
  renderer.domElement.addEventListener('pointermove', setPointer);
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    downAt = [ev.clientX, ev.clientY];
    anim = null;
    controls.enabled = true;
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) < 6) {
      setPointer(ev);
      if (hovered?.userData.cityId) showCard(hovered.userData.cityId);
    }
    downAt = null;
  });
  renderer.domElement.addEventListener('dblclick', (ev) => {
    const hit = setPointer(ev);
    if (hit) flyTo(hit.point.clone().normalize(), Math.max(R * 1.08, R + (camera.position.length() - R) * 0.45), 600);
  });
  renderer.domElement.addEventListener('pointerleave', () => tip.classList.remove('on'));

  // ---------- sizing & loop ----------
  let framed = false;
  function resize() {
    const w = container.clientWidth;
    const hgt = container.clientHeight;
    if (!w || !hgt) return;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    if (!framed) {
      framed = true;
      camera.position.copy(HOME_DIR).multiplyScalar(HOME_DIST * Math.max(1, 1.2 / camera.aspect));
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const v = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const timer = new THREE.Timer();
  let frame = 0;
  function loop(t) {
    frame = requestAnimationFrame(loop);
    if (document.hidden || !container.isConnected) return;
    timer.update();
    const elapsed = timer.getElapsed();
    stepAnim(t ?? performance.now());
    const dist = camera.position.length();
    // Spin slower the closer you are, like a map.
    controls.rotateSpeed = 0.12 + 0.88 * clamp((dist - R) / (R * 2), 0, 1);
    controls.zoomSpeed = 0.6 + 0.8 * clamp((dist - R) / (R * 2), 0, 1);

    for (const p of pins) {
      const d = camera.position.distanceTo(p.obj.position);
      p.obj.scale.setScalar(clamp(d / 85, 0.06, 1.3));
      p.obj.visible = d > DETAIL_DISTANCE * 0.55;
    }
    for (const dt of details) dt.obj.visible = camera.position.distanceTo(dt.obj.position) < DETAIL_DISTANCE;
    if (!reducedMotion()) {
      for (const m of movers) {
        if (m.spin) {
          m.obj.rotation.y = elapsed * 1.5;
          continue;
        }
        const a = m.phase + elapsed * m.speed;
        m.obj.position.set(m.center.x + Math.cos(a) * m.radius, m.y, m.center.z + Math.sin(a) * m.radius);
      }
    }
    if (controls.enabled) controls.update();
    renderer.render(scene, camera);

    const w = container.clientWidth;
    const hgt = container.clientHeight;
    for (const { el, pos, normal, minDist, maxDist } of anchors) {
      toCam.copy(camera.position).sub(pos).normalize();
      const facing = normal.dot(toCam) > 0.12;
      v.copy(pos).project(camera);
      const visible = facing && dist >= minDist && dist <= maxDist && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.display = visible ? '' : 'none';
      if (visible) el.style.transform = `translate(-50%, calc(-100% - 14px)) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px)`;
    }
  }

  resize();
  loop();

  return {
    update(data) {
      build(data);
    },
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      disposeWorld();
      controls.dispose();
      renderer.dispose();
    },
  };
}
