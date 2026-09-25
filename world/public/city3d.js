// The detailed 3D city. One city from the ledger projection, laid out as a small town:
//   City Hall (the Mayor) at the centre with the KPI beacon, the college campus beside it (dean,
//   professors, new agents), and each district as its own neighbourhood around them: a building per
//   department (taller = more agents), agents walking between them, streets and trees.
//   Pick a district (buttons, or click its ground) to fly there and list its departments and agents.
import * as THREE from './vendor/three-r186/three.module.min.js';
import { OrbitControls } from './vendor/three-r186/OrbitControls.min.js';
import { h } from './dom.js';

const STATES = ['enrolled', 'student', 'probationer', 'active', 'senior'];
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** Small deterministic random numbers, so a city always looks the same. */
function rng(seedText) {
  let s = 0;
  for (const ch of seedText) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Distinct, calm ground tints for districts (a light and dark step each). */
const DISTRICT_TINTS = ['#dfe8d5', '#e6dfcf', '#d6e2e8', '#e8d9dd', '#dcdcea', '#e3e6cf'];
const DISTRICT_TINTS_DARK = ['#2c3a2c', '#3a342a', '#2a363c', '#3c2e33', '#2f2f3d', '#35382a'];

export function mountCity3D(container, { onSelectDistrict }) {
  const canvasHost = h('div', { class: 'w3d-canvas', role: 'img', 'aria-label': 'Three-dimensional view of this city. The Details view has everything as text.' });
  const labels = h('div', { class: 'w3d-labels', 'aria-hidden': 'true' });
  const tip = h('div', { class: 'w3d-tip', role: 'status' });
  const picker = h('div', { class: 'c3d-picker', role: 'group', 'aria-label': 'Choose a district' });
  const panel = h('aside', { class: 'c3d-panel', 'aria-live': 'polite' });
  const reset = h('button', { type: 'button', class: 'w3d-btn c3d-home', 'aria-label': 'Whole city', title: 'Whole city', onclick: () => onSelectDistrict(null) }, '⌂');
  container.classList.add('c3d');
  container.replaceChildren(canvasHost, labels, tip, picker, panel, reset);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  canvasHost.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1500);
  camera.position.set(0, 70, 85);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 8;
  controls.maxDistance = 260;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.screenSpacePanning = false;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(60, 110, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, far: 400 });
  scene.add(sun);

  let world = new THREE.Group();
  scene.add(world);
  let movers = [];
  let anchors = [];
  const pickables = [];
  let districtSpots = new Map(); // districtId -> { center, radius, ground }
  let current = { city: null, districtId: null };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let downAt = null;
  let anim = null;

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...extra });
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
    world.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    scene.remove(world);
    world = new THREE.Group();
    scene.add(world);
    movers = [];
    anchors = [];
    pickables.length = 0;
    districtSpots = new Map();
    labels.replaceChildren();
  }

  function figure(color, tipText, extra = {}) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 4, 10), mat(color));
    body.position.y = 0.6;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), mat(color));
    head.position.y = 1.28;
    head.castShadow = true;
    g.add(body, head);
    pick(body, { tip: tipText, ...extra });
    pick(head, { tip: tipText, ...extra });
    return g;
  }

  function tree(rand, x, z, pal) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6), mat('#7a5a3c'));
    trunk.position.y = 0.6;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.9 + rand() * 0.4, 2 + rand(), 8), mat(pal.dark ? '#2f5a3a' : '#5f9a62'));
    crown.position.y = 2;
    crown.castShadow = true;
    g.add(trunk, crown);
    g.position.set(x, 0, z);
    return g;
  }

  function build(city, data) {
    dispose();
    const dark = document.documentElement.matches('[data-theme="dark"]') || (!document.documentElement.matches('[data-theme="light"]') && matchMedia('(prefers-color-scheme: dark)').matches);
    const pal = {
      dark,
      ground: dark ? '#1f2620' : '#e9eee4',
      road: dark ? '#3a3a38' : '#c9c7bf',
      building: css('--surface-2'),
      ink: css('--ink'),
      axis: css('--axis'),
      family: css(`--fam-${city.family}`),
      good: css('--good'),
      critical: css('--critical'),
      serious: css('--serious'),
      state: STATES.map((_, i) => css(`--st-${i}`)),
    };
    scene.background = new THREE.Color(dark ? '#141a17' : '#cfe3f0');
    scene.fog = new THREE.Fog(scene.background, 160, 420);
    const rand = rng(city.id);
    const now = Date.parse(data.now);
    const inJail = (a) => a.jail && (a.jail.status === 'awaiting_deletion' || Date.parse(a.jail.until) > now);

    // Ground.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(220, 64), mat(pal.ground, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    world.add(ground);

    // City Hall (the Mayor) and the KPI beacon.
    const hall = pick(new THREE.Mesh(new THREE.CylinderGeometry(4, 4.6, 5, 8), mat(pal.building)), { tip: `City Hall · Mayor ${city.mayorName}` });
    hall.position.y = 2.5;
    hall.castShadow = true;
    hall.receiveShadow = true;
    const hallRoof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.4, 8), mat(pal.family));
    hallRoof.position.y = 6.2;
    hallRoof.castShadow = true;
    world.add(hall, hallRoof);
    label('City Hall', `Mayor ${city.mayorName}`, new THREE.Vector3(0, 8.4, 0), 'hall');

    const kpi = city.kpi;
    const ratio = kpi && kpi.target ? Math.min(kpi.value / kpi.target, 1.5) : 0.25;
    const onTarget = kpi && kpi.target != null && kpi.value >= kpi.target;
    const lampColor = kpi ? (onTarget ? pal.good : pal.critical) : pal.axis;
    const beaconH = 4 + ratio * 8;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, beaconH, 8), mat(pal.axis));
    pole.position.set(6.5, beaconH / 2, 0);
    const lamp = pick(new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), mat(lampColor, { emissive: lampColor, emissiveIntensity: 0.6 })), {
      tip: kpi ? `KPI · ${kpi.metric.replaceAll('_', ' ')}: ${kpi.value}${kpi.target != null ? ` of ${kpi.target}${onTarget ? ' · on target' : ' · below target'}` : ''}` : 'No KPI pulse yet',
    });
    lamp.position.set(6.5, beaconH + 0.8, 0);
    world.add(pole, lamp);

    // College campus: a dome with professors, the dean, and new agents waiting for a department.
    const campus = new THREE.Vector3(-11, 0, 3);
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(6.5, 32), mat(dark ? '#2b3d2e' : '#cfe3c4'));
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(campus.x, 0.02, campus.z);
    lawn.receiveShadow = true;
    const dome = pick(new THREE.Mesh(new THREE.SphereGeometry(3.2, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(pal.axis)), {
      tip: `${city.name} college · dean ${city.college.dean?.name ?? 'not appointed'} · ${city.college.professors.length} professor(s)`,
    });
    dome.position.copy(campus);
    dome.castShadow = true;
    world.add(lawn, dome);
    label('College', `${city.college.professors.length} professor(s)${city.college.dean ? ` · Dean ${city.college.dean.name}` : ''}`, campus.clone().setY(4.6), 'college');
    city.college.professors.forEach((p, k) => {
      const a = (k / Math.max(1, city.college.professors.length)) * Math.PI * 2;
      const prof = pick(new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 12), mat(pal.ink)), { tip: `Professor ${p.name} (${p.id})${p.steppedIn ? ` · stepping in: ${p.steppedIn.role}` : ' · teaching'}` });
      prof.position.set(campus.x + Math.cos(a) * 4.6, 0.8, campus.z + Math.sin(a) * 4.6);
      prof.castShadow = true;
      world.add(prof);
    });
    city.college.enrolled.forEach((ag, k) => {
      const fig = figure(pal.state[0], `${ag.name} (${ag.id}) · new, waiting at the college for a department`);
      fig.position.set(campus.x + 5.6, 0, campus.z - 2 + k * 1.1);
      world.add(fig);
    });

    // Districts: neighbourhoods on a ring around the centre, sized by their departments.
    const districts = city.districts;
    const n = Math.max(1, districts.length);
    const plots = districts.map((d) => {
      const cols = Math.max(1, Math.ceil(Math.sqrt(d.departments.length)));
      return { d, cols, radius: Math.max(10, cols * 5.5 + 5) };
    });
    const ringR = Math.max(26, (plots.reduce((s, p) => s + p.radius * 2 + 6, 0)) / (2 * Math.PI));
    const tints = dark ? DISTRICT_TINTS_DARK : DISTRICT_TINTS;
    const jailed = [];

    plots.forEach(({ d, cols, radius }, i) => {
      const a = (i / n) * Math.PI * 2 + Math.PI / 5;
      const r = ringR + radius * 0.6;
      const center = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);

      // Street from City Hall to the district.
      const len = center.length() - radius;
      const road = new THREE.Mesh(new THREE.BoxGeometry(3, 0.03, len), mat(pal.road, { roughness: 1 }));
      road.rotation.y = Math.PI / 2 - a; // the box's length (z) points from City Hall to the district
      road.position.set(Math.cos(a) * (len / 2 + 4.6), 0.015, Math.sin(a) * (len / 2 + 4.6));
      road.receiveShadow = true;
      world.add(road);

      const plot = pick(new THREE.Mesh(new THREE.CircleGeometry(radius, 48), mat(tints[i % tints.length], { roughness: 1 })), {
        tip: `${d.name} district · supervisor ${d.supervisor} · ${d.departments.length} department(s) · click to go there`,
        districtId: d.id,
      });
      plot.rotation.x = -Math.PI / 2;
      plot.position.set(center.x, 0.03, center.z);
      plot.receiveShadow = true;
      world.add(plot);
      districtSpots.set(d.id, { center, radius, plot });
      // District name at the plot's outer edge, clear of its buildings' labels.
      label(d.name, `District · ${d.supervisor}`, center.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(radius * 0.92)).setY(1), 'district', d.id);

      // Trees around the edge.
      for (let t = 0; t < 7; t++) {
        const ta = rand() * Math.PI * 2;
        const tr = radius - 1.2 - rand() * 1.5;
        world.add(tree(rand, center.x + Math.cos(ta) * tr, center.z + Math.sin(ta) * tr, pal));
      }

      // Departments as buildings on a grid.
      d.departments.forEach((dp, k) => {
        const row = Math.floor(k / cols);
        const col = k % cols;
        const off = ((cols - 1) * 5.5) / 2;
        const pos = new THREE.Vector3(center.x + col * 5.5 - off, 0, center.z + row * 5.5 - off);
        const others = dp.agents.length - dp.graduatedCount;
        const height = 2.5 + dp.graduatedCount * 1.6 + others * 0.6;
        const building = pick(new THREE.Mesh(new THREE.BoxGeometry(3.2, height, 3.2), mat(pal.building)), {
          tip: `${dp.name} · ${dp.graduatedCount} working${dp.maxGraduated != null ? ` of ${dp.maxGraduated}` : ''} · ${dp.shadowCount} shadow(s) · ${dp.agents.length} total`,
          districtId: d.id,
        });
        building.position.set(pos.x, height / 2, pos.z);
        building.castShadow = true;
        building.receiveShadow = true;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 3.4), mat(pal.family));
        roof.position.set(pos.x, height + 0.15, pos.z);
        roof.castShadow = true;
        world.add(building, roof);
        // Lit windows, one row per floor.
        for (let f = 0; f < Math.floor(height / 1.6); f++) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.45), new THREE.MeshBasicMaterial({ color: dark ? '#e8c66a' : '#9ab8cf' }));
          win.position.set(pos.x, 1 + f * 1.6, pos.z + 1.61);
          world.add(win);
        }
        label(dp.name, `${dp.agents.length} agent(s)`, pos.clone().setY(height + 1.2), 'dept', d.id);
        if (dp.openRoleRequests.length) {
          const flag = pick(new THREE.Mesh(new THREE.OctahedronGeometry(0.6), mat(pal.serious, { emissive: pal.serious, emissiveIntensity: 0.4 })), {
            tip: `${dp.name}: ${dp.openRoleRequests.length} unfilled role(s)`,
            districtId: d.id,
          });
          flag.position.set(pos.x, height + 2.4, pos.z);
          world.add(flag);
          movers.push({ obj: flag, spin: true });
        }
        dp.agents.forEach((ag, j) => {
          if (inJail(ag)) {
            jailed.push(ag);
            return;
          }
          const status = ag.status?.status ?? 'idle';
          const fig = figure(pal.state[STATES.indexOf(ag.state)] ?? pal.axis,
            `${ag.name} (${ag.id}) · ${ag.state}${ag.badges.length ? ` · ${ag.badges.join(', ')}` : ''} · ${status}${ag.status?.activity ? `: ${ag.status.activity}` : ''}`,
            { districtId: d.id });
          const radiusA = 2.6 + (j % 3) * 0.5;
          const phase = (j / Math.max(1, dp.agents.length)) * Math.PI * 2;
          fig.position.set(pos.x + Math.cos(phase) * radiusA, 0, pos.z + Math.sin(phase) * radiusA);
          world.add(fig);
          if (status === 'working') movers.push({ obj: fig, center: pos, radius: radiusA, phase, speed: 0.3 + (j % 4) * 0.06 });
        });
      });
    });

    // Security City keeps the jail, holding every jailed agent from any city.
    if (city.id === 'security-city' || jailed.length) {
      const jailPos = new THREE.Vector3(10, 0, -9);
      const inside = city.id === 'security-city' ? data.jail : jailed.map((a) => ({ ...a, cityId: city.id }));
      const cage = pick(new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 6), new THREE.MeshBasicMaterial({ color: pal.critical, wireframe: true })), {
        tip: city.id === 'security-city' ? `Security jail · ${inside.length} inside` : `${inside.length} of this city's agents are in Security's jail`,
      });
      cage.position.set(jailPos.x, 1.75, jailPos.z);
      world.add(cage);
      inside.forEach((ag, k) => {
        const fig = figure(pal.critical, `${ag.name} (${ag.id}) · in jail${ag.jail?.status === 'awaiting_deletion' ? ', awaiting deletion' : ag.jail?.until ? ` until ${new Date(ag.jail.until).toLocaleString()}` : ''}`);
        fig.position.set(jailPos.x - 1.8 + (k % 3) * 1.8, 0, jailPos.z - 1.8 + Math.floor(k / 3) * 1.8);
        world.add(fig);
      });
      label(city.id === 'security-city' ? 'Jail' : "In Security's jail", `${inside.length}`, jailPos.clone().setY(4.6), 'jail');
    }

    // Picker buttons.
    picker.replaceChildren(
      h('button', { type: 'button', 'aria-pressed': String(!current.districtId), onclick: () => onSelectDistrict(null) }, 'Whole city'),
      ...districts.map((d) => h('button', { type: 'button', 'aria-pressed': String(current.districtId === d.id), onclick: () => onSelectDistrict(d.id) }, d.name)),
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
        h('div', { class: 'c3d-dept' },
          h('b', {}, dp.name),
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
    const spot = current.districtId && districtSpots.get(current.districtId);
    if (spot) flyTo(spot.center, spot.radius * 2.6 + 12, first ? 0 : 900);
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
      renderer.domElement.style.cursor = hovered.userData.districtId ? 'pointer' : 'default';
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
    if (document.hidden || !container.isConnected) return;
    timer.update();
    const elapsed = timer.getElapsed();
    stepAnim(t ?? performance.now());
    if (!reducedMotion()) {
      for (const m of movers) {
        if (m.spin) {
          m.obj.rotation.y = elapsed * 1.5;
          continue;
        }
        const a = m.phase + elapsed * m.speed;
        m.obj.position.set(m.center.x + Math.cos(a) * m.radius, 0, m.center.z + Math.sin(a) * m.radius);
        m.obj.rotation.y = -a;
      }
    }
    controls.update();
    renderer.render(scene, camera);
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
    show(city, data, districtId) {
      const first = current.city?.id !== city.id;
      const districtChanged = current.districtId !== (districtId ?? null);
      current = { city, districtId: districtId ?? null };
      build(city, data);
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
