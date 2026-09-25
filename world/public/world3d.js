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
import { CONTINENTS, DEG, FAMILY_ORDER, arcDegrees, cityPlaces, coastNoise, highwayLinks, landAt, rng } from './geo.js';
import { NEON, NEON_SET, animatePerson, disposeTree, facade, facadeBox, glow, makeRenderer, neon, person, solid, tower } from './cyber.js';

const R = 50; // globe radius
const FAMILY_LABEL = { revenue: 'Revenue', claude: 'Claude', gemini: 'Gemini', essentials: 'Essentials' };
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

const HOME_DIR = dirOf(HOME_LATLON.lat, HOME_LATLON.lon);
const HIGHWAY_LIFT = 1.0; // superhighways ride this high over the land, clear of the sprawl
const SPRAWL_MAX_H = 0.85;

let textureCache = null;
let texturePending = null;

/**
 * Equirectangular night-Earth texture: dark continents tinted by family with neon coastlines and
 * clusters of city lights, a black ocean glowing cyan in the shallows, and a faint survey grid.
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
  const night = [12, 14, 28];
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
  const hash = (x, y) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const warm = [255, 206, 140];
  const cool = [150, 240, 255];
  const pink = [255, 140, 235];

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
        const shade = 0.8 + 0.2 * coastNoise(la * 3.1, lons[x] * 2.7);
        const coast = edge > -0.012;
        const t = coast ? 0.9 : 0.16;
        r = (night[0] * (1 - t) + best.col[0] * t) * (coast ? 1 : shade);
        g = (night[1] * (1 - t) + best.col[1] * t) * (coast ? 1 : shade);
        b = (night[2] * (1 - t) + best.col[2] * t) * (coast ? 1 : shade);
        // City lights: clustered specks, denser where the noise says "urban".
        const urban = 0.5 + 0.5 * coastNoise(la * 7.3, lons[x] * 6.1);
        const hv = hash(x, y);
        if (!coast && hv < 0.004 + 0.03 * urban * urban) {
          const light = hv * 997 % 1 < 0.6 ? warm : hv * 331 % 1 < 0.5 ? cool : pink;
          const k = 0.35 + 0.4 * ((hv * 7919) % 1);
          r = r * (1 - k) + light[0] * k;
          g = g * (1 - k) + light[1] * k;
          b = b * (1 - k) + light[2] * k;
        }
      } else {
        const shallow = clamp(1 - edge / 0.06, 0, 1) ** 2;
        r = 3 + 6 * shallow;
        g = 6 + 70 * shallow;
        b = 16 + 95 * shallow;
      }
      if (gridRow || Math.abs(((x / W) * 360) % 15) < 0.18) {
        r = r * 0.8 + 6;
        g = g * 0.8 + 42;
        b = b * 0.8 + 58;
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

  const { renderer, isLost } = makeRenderer(container);
  canvasHost.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03020a');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 2000);
  camera.position.copy(HOME_DIR).multiplyScalar(HOME_DIST);
  scene.add(camera);
  // The controls steer `camera` straight down at the globe; we render through `view`, which tilts
  // towards the horizon as you come close to the ground (like Google Earth), without upsetting them.
  const view = camera.clone();
  scene.add(view);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.zoomToCursor = true;
  controls.minDistance = R + 2.2;
  controls.maxDistance = R * 5;
  controls.target.set(0, 0, 0);

  // Night: a dim cool light that follows the camera, a violet sky fill. The globe lights itself.
  const headlight = new THREE.DirectionalLight(0xb8c8ff, 1.2);
  headlight.position.set(0.4, 0.6, 1);
  view.add(headlight);
  scene.add(new THREE.HemisphereLight(0x8f86ff, 0x120a1e, 1.1));

  // Stars.
  const starGeo = new THREE.BufferGeometry();
  const stars = new Float32Array(3 * 1800);
  const starRand = rng('stars');
  for (let i = 0; i < 1800; i++) {
    const v = new THREE.Vector3(starRand() * 2 - 1, starRand() * 2 - 1, starRand() * 2 - 1).normalize().multiplyScalar(700 + starRand() * 300);
    stars.set([v.x, v.y, v.z], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.75 })));

  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 120), new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.15, emissive: '#ffffff', emissiveIntensity: 0 }));
  scene.add(globe);
  // Two atmosphere shells: a cyan rim and a wider magenta haze.
  for (const [k, color, opacity] of [[1.03, 0x19f0ff, 0.13], [1.075, 0xff2bd6, 0.06]]) {
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(R * k, 64, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    ));
  }

  let world = new THREE.Group();
  scene.add(world);
  let movers = [];
  let anchors = [];
  let pins = [];
  let details = [];
  let cityDirs = new Map();
  let traffic = [];
  const pickables = [];
  let dataRef = null;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let downAt = null;
  let anim = null;

  function disposeWorld() {
    disposeTree(world);
    scene.remove(world);
    world = new THREE.Group();
    scene.add(world);
    movers = [];
    anchors = [];
    pins = [];
    details = [];
    traffic = [];
    cityDirs = new Map();
    pickables.length = 0;
    labels.replaceChildren();
  }

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

  const PERSON_SCALE = 0.62; // people in city-model units
  /** An agent as a person in a city model; walkers circle `center`, others stand at `at`. */
  function addPerson(g, detail, look, info, { center = null, radius = 0, phase = 0, at = null, face = 0 }) {
    const p = person(look);
    p.group.scale.setScalar(PERSON_SCALE);
    pick(p.hit, info);
    g.add(p.group);
    if (center) {
      p.group.position.set(center.x + Math.cos(phase) * radius, 1.2, center.z + Math.sin(phase) * radius);
      movers.push({ kind: 'walk', p, center, radius, phase, speed: 0.7 / radius, detail });
    } else {
      p.group.position.copy(at);
      p.group.rotation.y = face;
      movers.push({ kind: 'idle', p, detail });
    }
  }

  /** A city's model in local units (y up), as seen when zoomed in. */
  function cityModel(c, fam, pal, jailed, now) {
    const g = new THREE.Group();
    const inJail = (a) => a.jail && (a.jail.status === 'awaiting_deletion' || Date.parse(a.jail.until) > now);
    const kpiText = c.kpi ? `${c.kpi.metric.replaceAll('_', ' ')}: ${c.kpi.value}${c.kpi.target != null ? ` / ${c.kpi.target}` : ''}` : 'No KPI pulse yet';
    const accent = pal.family[fam];

    // A dark hexagonal deck with a neon rim in the family colour.
    const platform = pick(new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM, PLATFORM + 0.6, 1.2, 6), solid('#0e1120', { metal: 0.5, rough: 0.5 })), { tip: `${c.name} · Mayor ${c.mayorName} · ${kpiText}`, cityId: c.id, city: true });
    platform.position.y = 0.6;
    g.add(platform);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(PLATFORM + 0.3, 0.12, 6, 6), neon(accent));
    rim.rotation.x = Math.PI / 2;
    rim.rotation.z = Math.PI / 6;
    rim.position.y = 1.2;
    g.add(rim);
    // Ring road between the college and the towers.
    const ringRoad = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.5, 48), solid('#171824', { rough: 0.95 }));
    ringRoad.rotation.x = -Math.PI / 2;
    ringRoad.position.y = 1.21;
    const ringLine = new THREE.Mesh(new THREE.RingGeometry(3.08, 3.12, 48), neon(NEON.amber, 0.8));
    ringLine.rotation.x = -Math.PI / 2;
    ringLine.position.y = 1.22;
    g.add(ringRoad, ringLine);

    const dome = pick(new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4fd8ff', transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.6, depthWrite: false })), {
      tip: `${c.name} college · dean ${c.college.dean?.name ?? 'not appointed'} · ${c.college.professors.length} professor(s) · ${c.college.enrolled.length} new agent(s) waiting`,
      cityId: c.id,
    });
    dome.position.y = 1.2;
    const ribs = new THREE.Mesh(new THREE.SphereGeometry(1.62, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: NEON.violet, wireframe: true, transparent: true, opacity: 0.6 }));
    ribs.position.y = 1.2;
    g.add(dome, ribs);
    c.college.professors.forEach((p, k) => {
      const a = (k / Math.max(1, c.college.professors.length)) * Math.PI * 2;
      addPerson(g, g, { jacket: '#2c2f45', seed: p.id, accent: NEON.violet, cap: NEON.violet },
        { tip: `Professor ${p.name} (${p.id})${p.steppedIn ? ` · stepping in: ${p.steppedIn.role}` : ' · teaching'}`, cityId: c.id },
        { at: new THREE.Vector3(Math.cos(a) * 2.2, 1.2, Math.sin(a) * 2.2), face: -a - Math.PI / 2 });
    });
    c.college.enrolled.forEach((a, k) => {
      const ang = Math.PI / 4 + k * 0.4;
      addPerson(g, g, { jacket: pal.state[0], seed: a.id, accent: NEON.cyan }, { tip: `${a.name} (${a.id}) · enrolled at the college`, cityId: c.id },
        { at: new THREE.Vector3(Math.cos(ang) * 3.1, 1.2, Math.sin(ang) * 3.1), face: -ang });
    });

    const depts = c.districts.flatMap((d, di) => d.departments.map((dp) => ({ dp, d, hue: NEON_SET[di % NEON_SET.length] })));
    depts.forEach(({ dp, d, hue }, k) => {
      const a = (k / Math.max(1, depts.length)) * Math.PI * 2 + Math.PI / 6;
      const pos = new THREE.Vector3(Math.cos(a) * 5.2, 0, Math.sin(a) * 5.2);
      const height = 2 + dp.graduatedCount * 1.3 + (dp.agents.length - dp.graduatedCount) * 0.45;
      const t = tower({ w: 1.7, d: 1.7, h: height, accent: hue, seed: dp.id });
      t.group.position.set(pos.x, 1.2, pos.z);
      t.group.rotation.y = Math.PI / 2 - a; // front faces the centre
      g.add(t.group);
      pick(t.hit, { tip: `${dp.name} (${d.name}) · ${dp.graduatedCount} working${dp.maxGraduated != null ? ` of ${dp.maxGraduated}` : ''} · ${dp.shadowCount} shadow(s) · ${dp.agents.length} total`, cityId: c.id });
      movers.push({ kind: 'blink', objs: t.blinkers, rate: 0.8 + (k % 3) * 0.3, detail: g });
      if (dp.openRoleRequests.length) {
        const flag = pick(new THREE.Mesh(new THREE.OctahedronGeometry(0.35), neon(pal.serious)), { tip: `${dp.name}: ${dp.openRoleRequests.length} unfilled role(s)`, cityId: c.id });
        flag.position.set(pos.x, 1.2 + t.top + 0.9, pos.z);
        g.add(flag);
        movers.push({ kind: 'spin', obj: flag, detail: g });
      }
      let standing = 0;
      dp.agents.forEach((ag, j) => {
        if (inJail(ag)) {
          jailed.push({ ag, city: c });
          return;
        }
        const look = { jacket: pal.state[STATES.indexOf(ag.state)] ?? pal.deemph, seed: ag.id, accent: hue };
        const info = { tip: `${ag.name} (${ag.id}) · ${ag.state}${ag.badges.length ? ` · ${ag.badges.join(', ')}` : ''} · ${ag.status?.status ?? 'no status yet'}${ag.status?.activity ? `: ${ag.status.activity}` : ''}`, cityId: c.id };
        if (ag.status?.status === 'working') {
          addPerson(g, g, look, info, { center: pos, radius: 1.45 + (j % 2) * 0.2, phase: (j / Math.max(1, dp.agents.length)) * Math.PI * 2 });
        } else {
          // Stand by the door, on the side facing the centre.
          const inward = pos.clone().multiplyScalar(-1).normalize();
          const side = new THREE.Vector3(-inward.z, 0, inward.x);
          const at = pos.clone().add(inward.clone().multiplyScalar(1.3)).add(side.multiplyScalar((standing % 3 - 1) * 0.5)).setY(1.2);
          standing++;
          addPerson(g, g, look, info, { at, face: Math.atan2(inward.x, inward.z) });
        }
      });
    });

    const ratio = c.kpi && c.kpi.target ? Math.min(c.kpi.value / c.kpi.target, 1.5) : 0.25;
    const beaconH = 1.5 + ratio * 4;
    const onTarget = c.kpi && c.kpi.target != null && c.kpi.value >= c.kpi.target;
    const lampColor = c.kpi ? (onTarget ? pal.good : pal.critical) : pal.deemph;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, beaconH, 8), solid('#3a3e52', { metal: 0.7, rough: 0.35 }));
    pole.position.set(PLATFORM - 1.2, 1.2 + beaconH / 2, 0);
    g.add(pole);
    const lamp = pick(new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), neon(lampColor)), {
      tip: `${c.name} KPI · ${kpiText}${c.kpi?.target != null ? (onTarget ? ' · on target' : ' · below target') : ''}`,
      cityId: c.id,
    });
    lamp.position.set(PLATFORM - 1.2, 1.2 + beaconH + 0.3, 0);
    const lampGlow = glow(lampColor, 3.2, 0.8);
    lampGlow.position.copy(lamp.position);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.6, 24, 12, 1, true), new THREE.MeshBasicMaterial({ color: lampColor, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(PLATFORM - 1.2, 1.2 + beaconH + 12, 0);
    g.add(lamp, lampGlow, beam);
    return g;
  }

  function jailModel(pal, jailed, detail) {
    const g = new THREE.Group();
    const at = new THREE.Vector3(-(PLATFORM - 2.4), 1.2, 0);
    const cage = pick(new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 3.2), new THREE.MeshBasicMaterial({ color: NEON.red, wireframe: true })), { tip: `Security jail · ${jailed.length} inside`, cityId: 'security-city' });
    cage.position.set(at.x, 2.3, 0);
    const jg = glow(NEON.red, 6, 0.35);
    jg.position.copy(cage.position);
    g.add(cage, jg);
    jailed.forEach(({ ag, city }, k) => {
      const until = ag.jail.status === 'awaiting_deletion' ? 'awaiting deletion' : `until ${new Date(ag.jail.until).toLocaleString()}`;
      addPerson(g, detail, { jacket: '#ff5a1f', seed: ag.id, accent: NEON.red }, { tip: `${ag.name} (${ag.id}) of ${city.name} · in jail, ${until}`, cityId: 'security-city' },
        { at: new THREE.Vector3(at.x - 0.9 + (k % 3) * 0.9, 1.2, -0.9 + Math.floor(k / 3) * 0.9), face: k });
    });
    return g;
  }

  /** Orient a group so its local +y is the globe's surface normal at `dir`. */
  const placeOnGlobe = (obj, dir, lift = 0) => {
    obj.position.copy(dir).multiplyScalar(R + lift);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  };

  // ---------- superhighways between cities ----------
  const CITY_EDGE_DEG = ((PLATFORM + 0.6) * CITY_SCALE) / R / DEG;
  const smooth = (x) => x * x * (3 - 2 * x);
  /** A point on the highway from a to b (unit vectors), at fraction t, `extra` above the deck. */
  function highwayPoint(a, b, omega, t, arch, extra, target) {
    const s = Math.sin(omega);
    target.copy(a).multiplyScalar(Math.sin((1 - t) * omega) / s).addScaledVector(b, Math.sin(t * omega) / s);
    // Ramps rise from each city deck to cruising height; long spans arch like bridges.
    const ramp = Math.min(smooth(clamp(t / 0.12, 0, 1)), smooth(clamp((1 - t) / 0.12, 0, 1)));
    const lift = 0.36 + (HIGHWAY_LIFT - 0.36) * ramp + arch * Math.sin(Math.PI * t) + extra;
    return target.setLength(R + lift);
  }

  function superhighways(places, pal) {
    const links = highwayLinks(places);
    const deckMat = solid('#1a1c2a', { metal: 0.6, rough: 0.4 });
    const pylonGeo = new THREE.CylinderGeometry(0.05, 0.07, 1, 6).translate(0, 0.5, 0);
    const pylons = [];
    for (const [ia, ib] of links) {
      const pa = places.get(ia);
      const pb = places.get(ib);
      const degs = arcDegrees(pa, pb);
      // Start and end at the city decks' edges.
      const f = clamp(CITY_EDGE_DEG / degs, 0, 0.45);
      const A = dirOf(pa.lat, pa.lon);
      const B = dirOf(pb.lat, pb.lon);
      const omegaFull = A.angleTo(B);
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      highwayPoint(A, B, omegaFull, f, 0, 0, a).normalize();
      highwayPoint(A, B, omegaFull, 1 - f, 0, 0, b).normalize();
      const omega = a.angleTo(b);
      const arch = Math.min(4, degs * 0.03);
      const segs = Math.max(24, Math.round(degs * 3));
      const curve = (extra) => {
        const c = new THREE.Curve();
        c.getPoint = (t, target = new THREE.Vector3()) => highwayPoint(a, b, omega, t, arch, extra, target);
        return c;
      };
      const names = `${dataRef.cities.find((c) => c.id === ia)?.name} ⇄ ${dataRef.cities.find((c) => c.id === ib)?.name}`;
      const deck = new THREE.Mesh(new THREE.TubeGeometry(curve(0), segs, 0.1, 6, false), deckMat);
      pick(deck, { tip: `Superhighway · ${names}` });
      const lane = new THREE.Mesh(new THREE.TubeGeometry(curve(0.09), segs, 0.03, 5, false), neon(NEON.cyan));
      world.add(deck, lane);
      // Pylons down to the ground every ~1.2 degrees.
      const p = new THREE.Vector3();
      for (let k = 1; k * 1.2 < degs; k++) {
        const t = (k * 1.2) / degs;
        highwayPoint(a, b, omega, t, arch, 0, p);
        if (p.length() - R > 0.5) pylons.push({ dir: p.clone().normalize(), len: p.length() - R });
      }
      // Traffic: head lights one way, tail lights the other.
      const cars = 6 + Math.round(degs / 5);
      for (let k = 0; k < cars; k++) traffic.push({ a, b, omega, arch, t: k / cars, speed: (0.9 / Math.max(6, degs)) * (0.8 + (k % 3) * 0.15), back: k % 2 === 1 });
    }
    if (pylons.length) {
      const inst = new THREE.InstancedMesh(pylonGeo, solid('#2a2d3d', { metal: 0.5, rough: 0.5 }), pylons.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      pylons.forEach((py, i) => {
        q.setFromUnitVectors(up, py.dir);
        m4.compose(py.dir.clone().multiplyScalar(R), q, new THREE.Vector3(1, py.len, 1));
        inst.setMatrixAt(i, m4);
      });
      world.add(inst);
    }
    if (traffic.length) {
      const carMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.045, 0.18), new THREE.MeshBasicMaterial({ color: '#ffffff' }), traffic.length);
      const white = new THREE.Color('#f4fbff');
      const red = new THREE.Color(NEON.red);
      traffic.forEach((tr, i) => carMesh.setColorAt(i, tr.back ? red : white));
      carMesh.frustumCulled = false;
      world.add(carMesh);
      traffic.mesh = carMesh;
    }
  }

  // ---------- the sprawl between cities ----------
  function sprawl(places) {
    const rand = rng('sprawl');
    const spots = [];
    const cities = [...places.values()];
    for (let k = 0; k < 9000 && spots.length < 3200; k++) {
      const lat = Math.asin(rand() * 2 - 1) / DEG;
      const lon = rand() * 360 - 180;
      if (!landAt(lat, lon)) continue;
      const near = Math.min(...cities.map((c) => arcDegrees(c, { lat, lon })));
      if (near < CITY_EDGE_DEG + 0.9) continue;
      // Denser and taller towards the cities, thinning out into the countryside.
      const pull = clamp(1 - near / 28, 0, 1);
      if (rand() > 0.25 + 0.75 * pull) continue;
      spots.push({ dir: dirOf(lat, lon), w: 0.18 + rand() * 0.3, d: 0.18 + rand() * 0.3, h: 0.12 + rand() * (0.2 + SPRAWL_MAX_H * 0.8 * pull), yaw: rand() * Math.PI });
    }
    const unit = facadeBox(4, 16, 4).translate(0, 8, 0);
    const byVariant = [[], [], [], []];
    spots.forEach((sp, i) => byVariant[i % 4].push(sp));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yawQ = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const tops = [];
    byVariant.forEach((list, v) => {
      const inst = new THREE.InstancedMesh(unit, facade(v), list.length);
      list.forEach((sp, i) => {
        q.setFromUnitVectors(up, sp.dir).multiply(yawQ.setFromAxisAngle(up, sp.yaw));
        m4.compose(sp.dir.clone().multiplyScalar(R - 0.02), q, new THREE.Vector3(sp.w / 4, sp.h / 16, sp.d / 4));
        inst.setMatrixAt(i, m4);
        if (rand() < 0.3) tops.push({ sp, q: q.clone() });
      });
      world.add(inst);
    });
    // Neon rooftops, so the sprawl glows from orbit.
    const crown = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), tops.length);
    const col = new THREE.Color();
    tops.forEach(({ sp, q: tq }, i) => {
      m4.compose(sp.dir.clone().multiplyScalar(R + sp.h - 0.01), tq, new THREE.Vector3(sp.w + 0.02, 0.03, sp.d + 0.02));
      crown.setMatrixAt(i, m4);
      crown.setColorAt(i, col.set(NEON_SET[Math.floor(rand() * NEON_SET.length)]));
    });
    world.add(crown);
  }

  function build(data) {
    dataRef = data;
    disposeWorld();
    const pal = palette();
    // Plain night ocean at once; the continents fill in when the (sliced) painting finishes.
    if (!globe.material.map) globe.material.color.set('#050a18');
    earthTexture(pal).then((texture) => {
      if (globe.material.map === texture) return;
      globe.material.map = texture;
      globe.material.emissiveMap = texture;
      globe.material.emissiveIntensity = 0.85;
      globe.material.color.set('#ffffff');
      globe.material.needsUpdate = true;
    });

    const now = Date.parse(data.now);
    const jailed = [];
    let securityGroup = null;
    datalist.replaceChildren(...data.cities.map((c) => h('option', { value: c.name })));
    const places = cityPlaces(data.cities);

    for (const fam of FAMILY_ORDER) {
      const cont = CONTINENTS[fam];
      const count = data.cities.filter((c) => c.family === fam).length;
      // Family name at the continent's southern edge, clear of its cities' labels.
      label(FAMILY_LABEL[fam], `${count} ${count === 1 ? 'city' : 'cities'}`, dirOf(cont.lat - cont.rad * 0.85, cont.lon).multiplyScalar(R * 1.01), 'family', { minDist: R * 1.9 });
    }
    for (const c of data.cities) {
      const spot = places.get(c.id);
      const fam = c.family;
      const dir = dirOf(spot.lat, spot.lon);
      cityDirs.set(c.id, dir);

      // Neon pin (kept a constant size on screen).
      const pin = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.2, 16), solid(pal.family[fam], { glow: 0.5, metal: 0.4 }));
      stem.rotation.x = Math.PI;
      stem.position.y = 1.1;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 16), neon(pal.family[fam]));
      head.position.y = 2.5;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), neon('#ffffff'));
      dot.position.set(0, 2.5, 0.55);
      const halo = glow(pal.family[fam], 4.5, 0.6);
      halo.position.y = 2.5;
      pin.add(stem, head, dot, halo);
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
    }
    if (securityGroup) securityGroup.add(jailModel(pal, jailed, securityGroup));
    superhighways(places, pal);
    sprawl(places);
  }

  // ---------- Google-Maps-style navigation ----------
  function flyTo(dir, dist, ms = reducedMotion() ? 0 : 900) {
    const fromDir = camera.position.clone().normalize();
    const fromDist = camera.position.length();
    anim = { fromDir, toDir: dir.clone().normalize(), fromDist, toDist: clamp(dist, controls.minDistance, controls.maxDistance), t0: performance.now(), ms };
    controls.enabled = false;
  }
  /** Zoom by altitude above the surface, like a map. */
  function zoomBy(f) {
    flyTo(camera.position.clone().normalize(), R + (camera.position.length() - R) * f, 400);
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
        h('button', { type: 'button', class: 'small-btn primary', onclick: () => onOpenCity(c.id, '3d') }, 'Enter 3D city'),
        h('button', { type: 'button', class: 'small-btn', onclick: () => onOpenCity(c.id) }, 'Details'),
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
    raycaster.setFromCamera(pointer, view);
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
    camera.aspect = view.aspect = w / hgt;
    camera.updateProjectionMatrix();
    view.updateProjectionMatrix();
    if (!framed) {
      framed = true;
      camera.position.copy(HOME_DIR).multiplyScalar(HOME_DIST * Math.max(1, 1.2 / camera.aspect));
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const north = new THREE.Vector3();
  const nadir = new THREE.Vector3();
  /** Tilt up to 62 degrees towards the horizon, from 14 units up down to the ground. */
  function tiltView() {
    const alt = camera.position.length() - R;
    const tilt = 1.08 * smooth(clamp(1 - (alt - 2.2) / 12, 0, 1));
    const n = nadir.copy(camera.position).normalize();
    north.set(0, 1, 0).addScaledVector(n, -n.y);
    if (north.lengthSq() < 1e-6) north.set(0, 0, 1);
    north.normalize();
    const surface = n.clone().multiplyScalar(R);
    view.position.copy(surface).addScaledVector(n, alt * Math.cos(tilt)).addScaledVector(north, -alt * Math.sin(tilt));
    // Screen-up stays north, exactly as the controls' own view has it when untilted.
    view.up.copy(north);
    view.lookAt(surface);
    view.updateMatrixWorld();
  }

  const v = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const timer = new THREE.Timer();
  let frame = 0;
  function loop(t) {
    frame = requestAnimationFrame(loop);
    if (document.hidden || !container.isConnected || isLost()) return;
    timer.update();
    const elapsed = timer.getElapsed();
    stepAnim(t ?? performance.now());
    const dist = camera.position.length();
    // Spin slower the closer you are, like a map.
    controls.rotateSpeed = clamp((dist - R) / (R * 2), 0.012, 1);
    controls.zoomSpeed = 0.6 + 0.8 * clamp((dist - R) / (R * 2), 0, 1);

    for (const p of pins) {
      const d = view.position.distanceTo(p.obj.position);
      p.obj.scale.setScalar(clamp(d / 85, 0.06, 1.3));
      p.obj.visible = d > DETAIL_DISTANCE * 0.55;
    }
    for (const dt of details) dt.obj.visible = view.position.distanceTo(dt.obj.position) < DETAIL_DISTANCE;
    const still = reducedMotion();
    for (const m of movers) {
      if (!m.detail.visible) continue;
      switch (m.kind) {
        case 'walk': {
          const a = m.phase + (still ? 0 : elapsed * m.speed);
          m.p.group.position.set(m.center.x + Math.cos(a) * m.radius, 1.2, m.center.z + Math.sin(a) * m.radius);
          m.p.group.rotation.y = -a;
          animatePerson(m.p.rig, elapsed, !still);
          break;
        }
        case 'idle':
          if (!still) animatePerson(m.p.rig, elapsed, false);
          break;
        case 'spin':
          if (!still) m.obj.rotation.y = elapsed * 1.5;
          break;
        case 'blink': {
          const on = still || Math.sin(elapsed * Math.PI * m.rate) > -0.2;
          for (const o of m.objs) o.visible = on;
          break;
        }
      }
    }
    if (traffic.mesh) {
      const p = new THREE.Vector3();
      const ahead = new THREE.Vector3();
      for (let i = 0; i < traffic.length; i++) {
        const tr = traffic[i];
        let t = (tr.t + (still ? 0 : elapsed * tr.speed)) % 1;
        if (tr.back) t = 1 - t;
        highwayPoint(tr.a, tr.b, tr.omega, t, tr.arch, 0.13, p);
        highwayPoint(tr.a, tr.b, tr.omega, clamp(t + (tr.back ? -0.002 : 0.002), 0, 1), tr.arch, 0.13, ahead);
        // Keep to the right of the centre line.
        const side = ahead.clone().sub(p).cross(p).normalize().multiplyScalar(tr.back ? 0.05 : -0.05);
        dummy.position.copy(p).add(side);
        dummy.up.copy(p).normalize();
        dummy.lookAt(ahead.add(side));
        dummy.updateMatrix();
        traffic.mesh.setMatrixAt(i, dummy.matrix);
      }
      traffic.mesh.instanceMatrix.needsUpdate = true;
    }
    if (controls.enabled) controls.update();
    tiltView();
    renderer.render(scene, view);

    const w = container.clientWidth;
    const hgt = container.clientHeight;
    for (const { el, pos, normal, minDist, maxDist } of anchors) {
      toCam.copy(view.position).sub(pos).normalize();
      const facing = normal.dot(toCam) > 0.12;
      v.copy(pos).project(view);
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
