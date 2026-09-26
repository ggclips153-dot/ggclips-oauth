// The detailed 3D city: one city from the ledger projection as a neon, cyberpunk town at night.
//   City Hall (the Mayor) is a spire at the centre with the KPI beacon beside it; the college campus
//   (glass dome, dean, professors in mortarboards, new agents) stands next to it. Each district is a
//   neighbourhood on a ring: a lit tower per department (taller = more agents, its name in neon), a
//   street grid, and the agents as people walking the block (working) or standing by the door.
//   Avenues run from City Hall to every district, streets join neighbouring districts, a beltway circles
//   the city, and elevated superhighways leave it towards the other cities (click one to go there).
//   A skyline fills the land between, with traffic on the roads and flying cars overhead.
//   Pick a district (buttons, or click its ground) to fly there and list its departments and agents.
import * as THREE from './vendor/three-r186/three.module.min.js';
import { OrbitControls } from './vendor/three-r186/OrbitControls.min.js';
import { h } from './dom.js';
import { bearing, cityPlaces, rng } from './geo.js';
import { NEON, NEON_SET, NIGHT, animatePerson, bakeStatic, disposeTree, fleet, glow, makeRenderer, groundTexture, neon, person, road as roadMesh, sign, skyTexture, skyline, solid, streetlight, tower } from './cyber.js';

const STATES = ['enrolled', 'student', 'probationer', 'active', 'senior'];
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

const CELL = 8; // spacing between department towers in a district
const HIGHWAY_Y = 7;
const WORLD_EDGE = 250;

export function mountCity3D(container, { onSelectDistrict, onOpenCity = null }) {
  const canvasHost = h('div', { class: 'w3d-canvas', role: 'img', 'aria-label': 'Three-dimensional view of this city. The Details view has everything as text.' });
  const labels = h('div', { class: 'w3d-labels', 'aria-hidden': 'true' });
  const tip = h('div', { class: 'w3d-tip', role: 'status' });
  const picker = h('div', { class: 'c3d-picker', role: 'group', 'aria-label': 'Choose a district' });
  const panel = h('aside', { class: 'c3d-panel', 'aria-live': 'polite' });
  const reset = h('button', { type: 'button', class: 'w3d-btn c3d-home', 'aria-label': 'Whole city', title: 'Whole city', onclick: () => onSelectDistrict(null) }, '⌂');
  container.classList.add('c3d');
  container.replaceChildren(canvasHost, labels, tip, picker, panel, reset);

  const { renderer, isLost, tick, fail } = makeRenderer(container, { onResize: () => resize(), onRestore: () => current.city && build(current.city, current.data) });
  canvasHost.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(NIGHT.fog, 110, 340);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.3, 1200);
  camera.position.set(0, 70, 85);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 4;
  controls.maxDistance = 280;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.screenSpacePanning = false;

  // Night: a cool moon, a violet sky fill, and two coloured city lights.
  scene.add(new THREE.HemisphereLight(0x8f86ff, 0x120a1e, 1.1));
  const moon = new THREE.DirectionalLight(0xa9c2ff, 1.1);
  moon.position.set(-60, 120, 40);
  scene.add(moon);
  const hallLight = new THREE.PointLight(0xff2bd6, 60, 60, 1.6);
  hallLight.position.set(0, 10, 0);
  const campusLight = new THREE.PointLight(0x19f0ff, 40, 40, 1.6);
  campusLight.position.set(-13, 8, 4);
  scene.add(hallLight, campusLight);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(WORLD_EDGE + 60, 72), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.9, metalness: 0.1 }));
  ground.material.map.repeat.set(70, 70);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  let world = new THREE.Group();
  scene.add(world);
  let movers = [];
  let cars = [];
  let cars3d = null;
  let anchors = [];
  const pickables = [];
  let districtSpots = new Map(); // districtId -> { center, radius, plot }
  let deptSpots = new Map(); // departmentId -> { pos, top, districtId }
  let current = { city: null, districtId: null, deptId: null };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let downAt = null;
  let anim = null;

  const pick = (mesh, info) => {
    Object.assign(mesh.userData, info);
    pickables.push(mesh);
    return mesh;
  };
  const label = (text, sub, pos, cls, districtId = null) => {
    const el = h('div', { class: `w3d-label c3d-${cls}` }, h('b', {}, text), sub && h('span', {}, sub));
    labels.append(el);
    anchors.push({ el, pos, districtId, cls });
  };

  function dispose() {
    disposeTree(world);
    scene.remove(world);
    world = new THREE.Group();
    scene.add(world);
    movers = [];
    cars = [];
    cars3d = null;
    anchors = [];
    pickables.length = 0;
    districtSpots = new Map();
    deptSpots = new Map();
    labels.replaceChildren();
  }

  /** An agent as a person; walkers circle `center` at `radius`, others stand at `at` facing `face`. */
  function addPerson(opts, info, { center = null, radius = 0, phase = 0, speed = 1.2, at = null, face = 0 } = {}) {
    const p = person(opts);
    p.group.userData.dynamic = true;
    pick(p.hit, info);
    world.add(p.group);
    if (center) {
      movers.push({ kind: 'walk', p, center, radius, phase, speed: speed / radius });
      p.group.position.set(center.x + Math.cos(phase) * radius, 0, center.z + Math.sin(phase) * radius);
    } else {
      p.group.position.copy(at);
      p.group.rotation.y = face;
      movers.push({ kind: 'idle', p });
    }
    return p;
  }

  /** Traffic along a straight road: cars in both directions, one lane each. */
  function traffic(a, b, count, rand, { y = 0, lane = 0.8 } = {}) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    for (let k = 0; k < count; k++) {
      const forward = k % 2 === 0;
      cars.push({ kind: 'car', a: forward ? a : b, b: forward ? b : a, off: side.clone().multiplyScalar(forward ? -lane : lane), len, t: rand(), speed: (7 + rand() * 6) / len, y });
    }
  }

  function build(city, data) {
    dispose();
    // Every street laid, so filler blocks keep off them.
    const streets = [];
    const road = (a, b, opts = {}) => {
      streets.push({ a, b, half: (opts.width ?? 3) / 2 });
      return roadMesh(a, b, opts);
    };
    const pal = {
      family: css(`--fam-${city.family}`),
      good: css('--good'),
      critical: css('--critical'),
      serious: css('--serious'),
      axis: css('--axis'),
      ink: css('--ink'),
      state: STATES.map((_, i) => css(`--st-${i}`)),
    };
    const rand = rng(city.id);
    const now = Date.parse(data.now);
    const inJail = (a) => a.jail && (a.jail.status === 'awaiting_deletion' || Date.parse(a.jail.until) > now);
    const agentTip = (ag) => `${ag.name} (${ag.id}) · ${ag.state}${ag.badges.length ? ` · ${ag.badges.join(', ')}` : ''} · ${ag.status?.status ?? 'no status yet'}${ag.status?.activity ? `: ${ag.status.activity}` : ''}`;

    // ---- City Hall: a spire with a family-coloured crown, and the KPI beacon ----
    const hall = tower({ w: 7, d: 7, h: 22, accent: pal.family, seed: `${city.id}-hall`, label: 'City Hall' });
    pick(hall.hit, { tip: `City Hall · Mayor ${city.mayorName}` });
    world.add(hall.group);
    movers.push({ kind: 'blink', objs: hall.blinkers, rate: 1.1 });
    const crown = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.14, 8, 48), neon(pal.family));
    crown.rotation.x = Math.PI / 2;
    crown.position.y = hall.top + 1.4;
    const crownGlow = glow(pal.family, 12, 0.5);
    crownGlow.position.y = hall.top + 1.4;
    world.add(crown, crownGlow);
    crown.userData.dynamic = true;
    movers.push({ kind: 'spin', obj: crown, axis: 'z', rate: 0.6 });
    label('City Hall', `Mayor ${city.mayorName}`, new THREE.Vector3(0, hall.top + 4, 0), 'hall');

    const kpi = city.kpi;
    const ratio = kpi && kpi.target ? Math.min(kpi.value / kpi.target, 1.5) : 0.25;
    const onTarget = kpi && kpi.target != null && kpi.value >= kpi.target;
    const lampColor = kpi ? (onTarget ? pal.good : pal.critical) : pal.axis;
    const beaconH = 5 + ratio * 10;
    const bx = 7.5;
    world.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, beaconH, 10), solid('#3a3e52', { metal: 0.7, rough: 0.35 })).translateX(bx).translateY(beaconH / 2));
    const lamp = pick(new THREE.Mesh(new THREE.SphereGeometry(0.9, 18, 12), neon(lampColor)), {
      tip: kpi ? `KPI · ${kpi.metric.replaceAll('_', ' ')}: ${kpi.value}${kpi.target != null ? ` of ${kpi.target}${onTarget ? ' · on target' : ' · below target'}` : ''}` : 'No KPI pulse yet',
    });
    lamp.position.set(bx, beaconH + 0.9, 0);
    const lampGlow = glow(lampColor, 7, 0.8);
    lampGlow.position.copy(lamp.position);
    // A searchlight beam up into the sky, in the KPI colour.
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.6, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color: lampColor, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(bx, beaconH + 31, 0);
    world.add(lamp, lampGlow, beam);
    movers.push({ kind: 'pulse', obj: lampGlow, base: 7 });

    // ---- College campus ----
    const campus = new THREE.Vector3(-14, 0, 4);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(8, 48), solid('#0d1420', { rough: 0.8 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(campus.x, 0.02, campus.z);
    const padRing = new THREE.Mesh(new THREE.RingGeometry(7.8, 8.1, 64), neon(NEON.cyan, 0.8));
    padRing.rotation.x = -Math.PI / 2;
    padRing.position.set(campus.x, 0.04, campus.z);
    world.add(pad, padRing);
    const dome = pick(new THREE.Mesh(new THREE.SphereGeometry(4, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4fd8ff', transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.6, depthWrite: false })), {
      tip: `${city.name} college · dean ${city.college.dean?.name ?? 'not appointed'} · ${city.college.professors.length} professor(s)`,
    });
    dome.position.copy(campus);
    const ribs = new THREE.Mesh(new THREE.SphereGeometry(4.02, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: NEON.violet, wireframe: true, transparent: true, opacity: 0.55 }));
    ribs.position.copy(campus);
    world.add(dome, ribs);
    label('College', `${city.college.professors.length} professor(s)${city.college.dean ? ` · Dean ${city.college.dean.name}` : ''}`, campus.clone().setY(5.6), 'college');
    if (city.college.dean) {
      addPerson({ jacket: '#d6b04a', seed: city.college.dean.id, accent: NEON.amber, cap: '#ffcf4a' }, { tip: `Dean ${city.college.dean.name} (${city.college.dean.id})` }, { at: campus.clone().add(new THREE.Vector3(0, 0, 0.5)), face: 0 });
    }
    city.college.professors.forEach((p, k) => {
      const a = (k / Math.max(1, city.college.professors.length)) * Math.PI * 2;
      const at = new THREE.Vector3(campus.x + Math.cos(a) * 2.4, 0, campus.z + Math.sin(a) * 2.4);
      addPerson({ jacket: '#2c2f45', seed: p.id, accent: NEON.violet, cap: NEON.violet },
        { tip: `Professor ${p.name} (${p.id})${p.steppedIn ? ` · stepping in: ${p.steppedIn.role}` : ' · teaching'}` },
        { at, face: Math.atan2(campus.x - at.x, campus.z - at.z) });
    });
    city.college.enrolled.forEach((ag, k) => {
      addPerson({ jacket: pal.state[0], seed: ag.id, accent: NEON.cyan }, { tip: `${ag.name} (${ag.id}) · new, waiting at the college for a department` },
        { at: new THREE.Vector3(campus.x + 6, 0, campus.z - 2.5 + k * 1.2), face: -Math.PI / 2 });
    });

    // ---- Districts on a ring around the centre ----
    const districts = city.districts;
    const n = Math.max(1, districts.length);
    const plots = districts.map((d) => {
      const cols = Math.max(1, Math.ceil(Math.sqrt(d.departments.length)));
      return { d, cols, radius: Math.max(13, cols * CELL * 0.72 + 7) };
    });
    const ringR = Math.max(34, plots.reduce((s, p) => s + p.radius * 2 + 10, 0) / (2 * Math.PI));
    const jailed = [];
    const placed = [];

    plots.forEach(({ d, cols, radius }, i) => {
      const a = (i / n) * Math.PI * 2 + Math.PI / 5;
      const r = ringR + radius * 0.6;
      const center = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      const hue = NEON_SET[i % NEON_SET.length];
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      placed.push({ center, radius, a, hue });

      // Avenue from City Hall to the district, lit along the way.
      const from = out.clone().multiplyScalar(7);
      const to = center.clone().sub(out.clone().multiplyScalar(radius - 0.5));
      world.add(road(from, to, { width: 4, kerb: hue }));
      traffic(from, to, 4, rand);
      const len = from.distanceTo(to);
      for (let k = 1; k * 9 < len; k++) {
        const at = from.clone().lerp(to, (k * 9) / len);
        const sl = streetlight(hue);
        sl.position.copy(at.add(new THREE.Vector3(-out.z, 0, out.x).multiplyScalar(k % 2 ? 2.6 : -2.6)));
        sl.rotation.y = Math.atan2(out.z * (k % 2 ? 1 : -1), -out.x * (k % 2 ? 1 : -1));
        world.add(sl);
      }

      // The neighbourhood: a dark pad with a neon edge (click to go there).
      const plot = pick(new THREE.Mesh(new THREE.CircleGeometry(radius, 56), new THREE.MeshStandardMaterial({ color: new THREE.Color('#0b0d16').lerp(new THREE.Color(hue), 0.06), roughness: 0.85, metalness: 0.1 })), {
        tip: `${d.name} district · supervisor ${d.supervisor} · ${d.departments.length} department(s) · click to go there`,
        districtId: d.id,
      });
      plot.rotation.x = -Math.PI / 2;
      plot.position.set(center.x, 0.025, center.z);
      const edge = new THREE.Mesh(new THREE.RingGeometry(radius - 0.35, radius, 72), neon(hue, 0.9));
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(center.x, 0.045, center.z);
      world.add(plot, edge);
      districtSpots.set(d.id, { center, radius, plot });
      label(d.name, `District · ${d.supervisor}`, center.clone().add(out.clone().multiplyScalar(radius * 0.95)).setY(1.5), 'district', d.id);

      // Street grid between the department blocks.
      const rows = Math.max(1, Math.ceil(d.departments.length / cols));
      const halfW = (cols * CELL) / 2;
      const halfH = (rows * CELL) / 2;
      for (let c = 0; c <= cols; c++) {
        const x = center.x - halfW + c * CELL;
        world.add(road(new THREE.Vector3(x, 0.01, center.z - halfH - 1), new THREE.Vector3(x, 0.01, center.z + halfH + 1), { width: 2.2, lines: false, kerb: hue }));
      }
      for (let rr = 0; rr <= rows; rr++) {
        const z = center.z - halfH + rr * CELL;
        world.add(road(new THREE.Vector3(center.x - halfW - 1, 0.012, z), new THREE.Vector3(center.x + halfW + 1, 0.012, z), { width: 2.2, lines: false, kerb: hue }));
      }
      // Streetlights around the edge of the neighbourhood.
      for (let k = 0; k < 8; k++) {
        const la = (k / 8) * Math.PI * 2 + 0.2;
        const sl = streetlight(hue);
        sl.position.set(center.x + Math.cos(la) * (radius - 1.4), 0, center.z + Math.sin(la) * (radius - 1.4));
        sl.rotation.y = Math.atan2(-Math.cos(la), -Math.sin(la));
        world.add(sl);
      }

      // Departments as towers in the blocks.
      d.departments.forEach((dp, k) => {
        const row = Math.floor(k / cols);
        const col = k % cols;
        const pos = new THREE.Vector3(center.x - halfW + CELL / 2 + col * CELL, 0, center.z - halfH + CELL / 2 + row * CELL);
        const others = dp.agents.length - dp.graduatedCount;
        const height = 5 + dp.graduatedCount * 2.6 + others * 1;
        const t = tower({ w: 4.2, d: 4.2, h: height, accent: hue, seed: dp.id, label: dp.name, blade: d.name });
        t.group.position.copy(pos);
        world.add(t.group);
        deptSpots.set(dp.id, { pos, top: t.top, districtId: d.id });
        pick(t.hit, {
          tip: `${dp.name} · ${dp.graduatedCount} working${dp.maxGraduated != null ? ` of ${dp.maxGraduated}` : ''} · ${dp.shadowCount} shadow(s) · ${dp.agents.length} total`,
          districtId: d.id,
        });
        movers.push({ kind: 'blink', objs: t.blinkers, rate: 0.7 + rand() });
        label(dp.name, `${dp.agents.length} agent(s)`, pos.clone().setY(t.top + 3.2), 'dept', d.id);
        if (dp.openRoleRequests.length) {
          const flag = pick(new THREE.Mesh(new THREE.OctahedronGeometry(0.8), neon(pal.serious)), { tip: `${dp.name}: ${dp.openRoleRequests.length} unfilled role(s)`, districtId: d.id });
          flag.position.set(pos.x, t.top + 1.8, pos.z);
          const fg = glow(pal.serious, 4, 0.7);
          fg.position.copy(flag.position);
          world.add(flag, fg);
          flag.userData.dynamic = true;
          movers.push({ kind: 'spin', obj: flag, axis: 'y', rate: 1.5 });
        }
        // Agents: working ones walk the block, the rest stand by the door.
        let standing = 0;
        dp.agents.forEach((ag, j) => {
          if (inJail(ag)) {
            jailed.push(ag);
            return;
          }
          const look = { jacket: pal.state[STATES.indexOf(ag.state)] ?? pal.axis, seed: ag.id, accent: hue };
          const info = { tip: agentTip(ag), districtId: d.id };
          if (ag.status?.status === 'working') {
            addPerson(look, info, { center: pos, radius: 3.2 + (j % 2) * 0.35, phase: (j / Math.max(1, dp.agents.length)) * Math.PI * 2, speed: 1.1 + (j % 3) * 0.15 });
          } else {
            const at = new THREE.Vector3(pos.x - 1.3 + (standing % 3) * 1.3, 0, pos.z + 2.6 + Math.floor(standing / 3) * 0.9);
            standing++;
            addPerson(look, info, { at, face: (rand() - 0.5) * 1.2 });
          }
        });
      });
    });

    // ---- Streets joining neighbouring districts, and the beltway around the city ----
    if (placed.length > 1) {
      placed.forEach((p, i) => {
        const q = placed[(i + 1) % placed.length];
        if (placed.length === 2 && i === 1) return;
        const dir = q.center.clone().sub(p.center).normalize();
        const a = p.center.clone().add(dir.clone().multiplyScalar(p.radius - 0.5));
        const b = q.center.clone().sub(dir.clone().multiplyScalar(q.radius - 0.5));
        if (a.distanceTo(b) < 2) return;
        world.add(road(a, b, { width: 3.2, kerb: NEON.violet }));
        traffic(a, b, 2, rand, { lane: 0.7 });
      });
    }
    const beltR = Math.max(ringR + 30, ...placed.map((p) => p.center.length() + p.radius + 9));
    const SEG = 48;
    for (let k = 0; k < SEG; k++) {
      const a0 = (k / SEG) * Math.PI * 2;
      const a1 = ((k + 1) / SEG) * Math.PI * 2;
      const a = new THREE.Vector3(Math.cos(a0) * beltR, 0, Math.sin(a0) * beltR);
      const b = new THREE.Vector3(Math.cos(a1) * beltR, 0, Math.sin(a1) * beltR);
      world.add(road(a, b, { width: 5, kerb: NEON.magenta }));
      if (k % 4 === 0) traffic(a, b, 2, rand, { lane: 1.1 });
    }
    // Spokes from each district out to the beltway.
    for (const p of placed) {
      const out = new THREE.Vector3(Math.cos(p.a), 0, Math.sin(p.a));
      const a = p.center.clone().add(out.clone().multiplyScalar(p.radius - 0.5));
      const b = out.clone().multiplyScalar(beltR - 2.5);
      if (b.length() - a.length() > 2) {
        world.add(road(a, b, { width: 3.2, kerb: p.hue }));
        traffic(a, b, 2, rand, { lane: 0.7 });
      }
    }

    // ---- Blocks filling the land inside the beltway and around each neighbourhood's grid ----
    const jailAt = city.id === 'security-city' || jailed.length ? new THREE.Vector3(12, 0, -11) : null;
    const distToSeg = (x, z, { a, b }) => {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    };
    const infill = [];
    for (let x = -beltR; x <= beltR; x += 6.5) {
      for (let z = -beltR; z <= beltR; z += 6.5) {
        const px = x + (rand() - 0.5) * 1.6;
        const pz = z + (rand() - 0.5) * 1.6;
        const r = Math.hypot(px, pz);
        if (r > beltR - 5 || r < 17) continue;
        if (Math.hypot(px - campus.x, pz - campus.z) < 11) continue;
        if (jailAt && Math.hypot(px - jailAt.x, pz - jailAt.z) < 8) continue;
        const size = 2.4 + rand() * 1.8;
        let inPlot = false;
        let ok = true;
        for (const p of plots.map((q, i) => ({ ...q, ...placed[i] }))) {
          const dd = Math.hypot(px - p.center.x, pz - p.center.z);
          if (dd > p.radius + size) continue;
          inPlot = true;
          const rows = Math.max(1, Math.ceil(p.d.departments.length / p.cols));
          const inGrid = Math.abs(px - p.center.x) < (p.cols * CELL) / 2 + size && Math.abs(pz - p.center.z) < (rows * CELL) / 2 + size;
          if (dd > p.radius - size - 1.8 || inGrid) ok = false;
        }
        if (!ok || streets.some((st) => distToSeg(px, pz, st) < st.half + size * 0.75 + 0.6)) continue;
        if (rand() < 0.4) continue;
        infill.push({ x: px, z: pz, w: size, d: size * (0.8 + rand() * 0.4), h: inPlot ? 1.8 + rand() * 3 : 2.2 + rand() * 5.5 });
      }
    }
    world.add(skyline(infill, `${city.id}-infill`, { billboards: 0, crownShare: 0.2 }));

    // ---- Superhighways to the other cities, pointing the way they really lie on the globe ----
    const places = cityPlaces(data.cities);
    const here = places.get(city.id);
    const exits = new Map(); // 20-degree heading bucket -> { heading, cities }
    if (here) {
      for (const c of data.cities) {
        if (c.id === city.id || !places.get(c.id)) continue;
        const b = bearing(here, places.get(c.id));
        const key = Math.round(b / 20) % 18;
        const e = exits.get(key) ?? { heading: key * 20, cities: [] };
        e.cities.push(c);
        exits.set(key, e);
      }
    }
    const corridors = [];
    for (const e of exits.values()) {
      // North is -z, east is +x.
      const dir = new THREE.Vector3(Math.sin(e.heading * (Math.PI / 180)), 0, -Math.cos(e.heading * (Math.PI / 180)));
      corridors.push(dir);
      const names = e.cities.map((c) => c.name).join(' · ');
      const info = { tip: `To ${names}${onOpenCity ? ` · click to go to ${e.cities[0].name}` : ''}`, openCity: e.cities[0].id };
      const rampStart = dir.clone().multiplyScalar(beltR + 2.5);
      const rampTop = dir.clone().multiplyScalar(beltR + 28).setY(HIGHWAY_Y);
      const end = dir.clone().multiplyScalar(WORLD_EDGE + 40).setY(HIGHWAY_Y);
      for (const [a, b] of [[rampStart, rampTop], [rampTop, end]]) {
        const deck = road(a, b, { width: 6, kerb: NEON.cyan, deck: 0.6 });
        world.add(deck);
        pick(deck.children[0], { tip: `Superhighway to ${names} · click the green sign to go there` });
        traffic(a.clone().setY(a.y + 0.03), b.clone().setY(b.y + 0.03), a === rampStart ? 2 : 6, rand, { lane: 1.3 });
      }
      // Pillars under the elevated span.
      const pillarLen = rampTop.distanceTo(end);
      for (let k = 0; k * 14 < pillarLen; k++) {
        const at = rampTop.clone().lerp(end, (k * 14) / pillarLen);
        world.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, HIGHWAY_Y - 0.3, 10), solid('#2a2d3d', { metal: 0.5, rough: 0.5 })).translateX(at.x).translateZ(at.z).translateY((HIGHWAY_Y - 0.3) / 2));
      }
      // Gantry sign over the road.
      const gantryAt = dir.clone().multiplyScalar(beltR + 40).setY(HIGHWAY_Y);
      const plate = sign(`→ ${e.cities[0].name}${e.cities.length > 1 ? ` +${e.cities.length - 1}` : ''}`, NEON.lime, 1.4, { maxWidth: 12 });
      plate.position.copy(gantryAt).setY(HIGHWAY_Y + 4.2);
      plate.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
      world.add(plate);
      pick(plate, info);
      label(`→ ${e.cities[0].name}`, e.cities.length > 1 ? `and ${e.cities.length - 1} more` : 'Superhighway', gantryAt.clone().setY(HIGHWAY_Y + 7), 'exit');
    }

    // ---- Flying cars overhead ----
    for (let k = 0; k < 16; k++) {
      cars.push({ kind: 'fly', r: 20 + rand() * (beltR + 30), y: 14 + rand() * 22, phase: rand() * Math.PI * 2, speed: (0.04 + rand() * 0.06) * (k % 2 ? 1 : -1) });
    }

    // ---- The skyline filling the land beyond the beltway, clear of the superhighways ----
    const spots = [];
    const clearOfHighways = (x, z) => corridors.every((dir) => {
      const along = x * dir.x + z * dir.z;
      return along < 0 || Math.abs(x * dir.z - z * dir.x) > 8;
    });
    for (let r = beltR + 10; r < WORLD_EDGE; r += 9) {
      const steps = Math.floor((2 * Math.PI * r) / 9);
      for (let k = 0; k < steps; k++) {
        if (rand() < 0.2) continue;
        const a = (k / steps) * Math.PI * 2 + rand() * 0.02;
        const rr = r + (rand() - 0.5) * 3;
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        if (!clearOfHighways(x, z)) continue;
        const band = 1 - Math.abs((r - beltR - 60) / 120);
        spots.push({ x, z, w: 3 + rand() * 3.5, d: 3 + rand() * 3.5, h: 6 + rand() * 18 + Math.max(0, band) * rand() * 40 });
      }
    }
    world.add(skyline(spots, city.id));

    // ---- Security City keeps the jail, holding every jailed agent from any city ----
    if (city.id === 'security-city' || jailed.length) {
      const jailPos = new THREE.Vector3(12, 0, -11);
      const inside = city.id === 'security-city' ? data.jail : jailed.map((a) => ({ ...a, cityId: city.id }));
      const cage = pick(new THREE.Mesh(new THREE.BoxGeometry(7, 4, 7), new THREE.MeshBasicMaterial({ color: NEON.red, wireframe: true })), {
        tip: city.id === 'security-city' ? `Security jail · ${inside.length} inside` : `${inside.length} of this city's agents are in Security's jail`,
      });
      cage.position.set(jailPos.x, 2, jailPos.z);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), neon(NEON.red, 0.18));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(jailPos.x, 0.05, jailPos.z);
      const jg = glow(NEON.red, 14, 0.35);
      jg.position.set(jailPos.x, 2, jailPos.z);
      world.add(cage, floor, jg);
      inside.forEach((ag, k) => {
        addPerson({ jacket: '#ff5a1f', seed: ag.id, accent: NEON.red },
          { tip: `${ag.name} (${ag.id}) · in jail${ag.jail?.status === 'awaiting_deletion' ? ', awaiting deletion' : ag.jail?.until ? ` until ${new Date(ag.jail.until).toLocaleString()}` : ''}` },
          { at: new THREE.Vector3(jailPos.x - 2 + (k % 3) * 2, 0, jailPos.z - 2 + Math.floor(k / 3) * 2), face: rand() * Math.PI * 2 });
      });
      label(city.id === 'security-city' ? 'Jail' : "In Security's jail", `${inside.length}`, jailPos.clone().setY(5.2), 'jail');
    }

    // All the traffic in three draw calls, then merge the static scenery by material.
    cars3d = fleet(cars.length, city.id);
    world.add(cars3d.group);
    bakeStatic(world, new Set(pickables));
    renderPicker(city);
  }

  function renderPicker(city) {
    const withDepts = city.districts.filter((d) => d.departments.length);
    const jump = withDepts.length
      ? h('select', {
          'aria-label': 'Jump to department',
          onchange: (ev) => {
            const [dId, dpId] = ev.target.value.split('|');
            if (dpId) onSelectDistrict(dId, dpId);
          },
        },
        h('option', { value: '' }, 'Jump to department…'),
        withDepts.map((d) => h('optgroup', { label: d.name }, d.departments.map((dp) => h('option', { value: `${d.id}|${dp.id}`, selected: current.deptId === dp.id }, dp.name)))))
      : null;
    picker.replaceChildren(
      h('button', { type: 'button', 'aria-pressed': String(!current.districtId), onclick: () => onSelectDistrict(null) }, 'Whole city'),
      ...city.districts.map((d) => h('button', { type: 'button', 'aria-pressed': String(current.districtId === d.id && !current.deptId), onclick: () => onSelectDistrict(d.id) }, d.name)),
      jump,
    );
  }

  function renderPanel(city) {
    const d = city.districts.find((x) => x.id === current.districtId);
    if (!d) {
      const counts = city.agentCounts;
      panel.replaceChildren(
        h('h3', {}, city.name),
        h('p', { class: 'small secondary' }, `Mayor ${city.mayorName} · ${city.districts.length} district(s)`),
        h('p', { class: 'small' }, STATES.map((s) => `${cap(s)} ${counts[s] ?? 0}`).join(' · ')),
        h('p', { class: 'small secondary' }, 'Choose a district above, or click its ground, to go there.'),
      );
      return;
    }
    panel.replaceChildren(
      h('h3', {}, d.name),
      h('p', { class: 'small secondary' }, `District supervisor ${d.supervisor}`),
      ...d.departments.map((dp) =>
        h('div', { class: `c3d-dept${current.deptId === dp.id ? ' current' : ''}` },
          h('button', { type: 'button', class: 'c3d-dept-name', title: 'Fly to this department', onclick: () => onSelectDistrict(d.id, dp.id) }, dp.name),
          h('span', { class: 'small secondary' }, ` · ${dp.graduatedCount} working, ${dp.shadowCount} shadow(s)`),
          h('ul', {}, dp.agents.map((a) => h('li', { class: 'small' }, `${a.name} · ${a.state}${a.status ? ` · ${a.status.status}${a.status.activity ? `: ${a.status.activity}` : ''}` : ''}`))),
        )),
      ...(d.departments.length ? [] : [h('p', { class: 'small muted' }, 'No departments yet.')]),
    );
  }

  // ---------- camera ----------
  function flyTo(target, distance, ms = reducedMotion() ? 0 : 900) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.45) dir.setY(0.45).normalize();
    anim = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      toPos: target.clone().add(dir.multiplyScalar(distance)),
      t0: performance.now(),
      ms,
    };
  }
  function stepAnim(t) {
    if (!anim) return;
    const k = anim.ms ? clamp((t - anim.t0) / anim.ms, 0, 1) : 1;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    camera.position.lerpVectors(anim.fromPos, anim.toPos, e);
    controls.target.lerpVectors(anim.fromTarget, anim.toTarget, e);
    if (k >= 1) anim = null;
  }
  function focus(first) {
    const dept = current.deptId && deptSpots.get(current.deptId);
    const spot = current.districtId && districtSpots.get(current.districtId);
    if (dept) flyTo(dept.pos.clone().setY(Math.min(dept.top * 0.35, 6)), Math.max(16, dept.top * 1.5), first ? 0 : 900);
    else if (spot) flyTo(spot.center, spot.radius * 2.6 + 12, first ? 0 : 900);
    else {
      let far = 30;
      for (const s of districtSpots.values()) far = Math.max(far, s.center.length() + s.radius);
      flyTo(new THREE.Vector3(0, 0, 0), far * 1.9, first ? 0 : 900);
    }
    dimOthers();
  }
  /** Dim the other districts while one is chosen. */
  function dimOthers() {
    for (const [id, s] of districtSpots) {
      s.plot.material.transparent = !!current.districtId && id !== current.districtId;
      s.plot.material.opacity = s.plot.material.transparent ? 0.45 : 1;
    }
  }

  // ---------- interaction ----------
  function setPointer(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    hovered = raycaster.intersectObjects(pickables, false)[0]?.object ?? null;
    if (hovered) {
      tip.textContent = hovered.userData.tip;
      tip.classList.add('on');
      tip.style.left = `${ev.clientX - r.left + 14}px`;
      tip.style.top = `${ev.clientY - r.top + 14}px`;
      renderer.domElement.style.cursor = hovered.userData.districtId || (hovered.userData.openCity && onOpenCity) ? 'pointer' : 'default';
    } else {
      tip.classList.remove('on');
      renderer.domElement.style.cursor = 'grab';
    }
  }
  renderer.domElement.addEventListener('pointermove', setPointer);
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    downAt = [ev.clientX, ev.clientY];
    anim = null;
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) < 6) {
      setPointer(ev);
      const id = hovered?.userData.districtId;
      if (id && id !== current.districtId) onSelectDistrict(id);
      else if (hovered?.userData.openCity && onOpenCity) onOpenCity(hovered.userData.openCity);
    }
    downAt = null;
  });
  renderer.domElement.addEventListener('pointerleave', () => tip.classList.remove('on'));

  // ---------- sizing & loop ----------
  function resize() {
    const w = container.clientWidth;
    const hgt = container.clientHeight;
    if (!w || !hgt) return;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const v = new THREE.Vector3();
  const timer = new THREE.Timer();
  let frame = 0;
  function loop(t) {
    frame = requestAnimationFrame(loop);
    if (document.hidden || !container.isConnected || isLost()) return;
    try {
      step(t);
    } catch (err) {
      cancelAnimationFrame(frame);
      fail(err);
    }
  }
  function step(t) {
    timer.update();
    const elapsed = timer.getElapsed();
    stepAnim(t ?? performance.now());
    const still = reducedMotion();
    for (const m of movers) {
      switch (m.kind) {
        case 'walk': {
          const a = m.phase + (still ? 0 : elapsed * m.speed);
          m.p.group.position.set(m.center.x + Math.cos(a) * m.radius, 0, m.center.z + Math.sin(a) * m.radius);
          m.p.group.rotation.y = -a;
          animatePerson(m.p.rig, elapsed, !still);
          break;
        }
        case 'idle':
          if (!still) animatePerson(m.p.rig, elapsed, false);
          break;
        case 'spin':
          if (!still) m.obj.rotation[m.axis] = elapsed * m.rate;
          break;
        case 'blink': {
          const on = still || Math.sin(elapsed * Math.PI * m.rate) > -0.2;
          for (const o of m.objs) o.visible = on;
          break;
        }
        case 'pulse':
          if (!still) m.obj.scale.setScalar(m.base * (1 + 0.12 * Math.sin(elapsed * 3)));
          break;
      }
    }
    if (cars3d) {
      cars.forEach((c, i) => {
        if (c.kind === 'fly') {
          const a = c.phase + (still ? 0 : elapsed * c.speed);
          v.set(Math.cos(a) * c.r, c.y + Math.sin(a * 3) * 0.6, Math.sin(a) * c.r);
          cars3d.place(i, v, -a + (c.speed > 0 ? 0 : Math.PI));
        } else {
          const t = (c.t + (still ? 0 : elapsed * c.speed)) % 1;
          v.lerpVectors(c.a, c.b, t).add(c.off);
          v.y += c.y;
          cars3d.place(i, v, Math.atan2(c.b.x - c.a.x, c.b.z - c.a.z), -Math.atan2(c.b.y - c.a.y, Math.hypot(c.b.x - c.a.x, c.b.z - c.a.z)));
        }
      });
      cars3d.commit();
    }
    controls.update();
    renderer.render(scene, camera);
    tick(t ?? performance.now());
    const w = container.clientWidth;
    const hgt = container.clientHeight;
    const dist = camera.position.distanceTo(controls.target);
    for (const { el, pos, districtId, cls } of anchors) {
      // Department names only for the chosen district, or when close.
      const show = cls !== 'dept' || districtId === current.districtId || dist < 45;
      v.copy(pos).project(camera);
      const visible = show && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.display = visible ? '' : 'none';
      if (visible) el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px)`;
    }
  }
  resize();
  loop();

  return {
    /** Show a city (rebuilt from fresh data) and focus a district, or the whole city when null. */
    show(city, data, districtId, deptId = null) {
      const first = current.city?.id !== city.id;
      const districtChanged = current.districtId !== (districtId ?? null) || current.deptId !== (deptId ?? null);
      // Rebuild only for a new city or fresh ledger data; choosing a district just moves the camera.
      // A refresh that brings no new ledger events (the same lastSeq) changes nothing on screen.
      const rebuild = first || current.data?.lastSeq !== data.lastSeq;
      current = { city, districtId: districtId ?? null, deptId: deptId ?? null, data };
      if (rebuild) {
        try {
          build(city, data);
        } catch (err) {
          fail(err);
          return;
        }
      }
      else renderPicker(city);
      renderPanel(city);
      // A live refresh keeps the camera where you left it; only a new city or district moves it.
      if (first || districtChanged) focus(first);
      else dimOthers();
    },
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      dispose();
      controls.dispose();
      renderer.dispose();
    },
  };
}
