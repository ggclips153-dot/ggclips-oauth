// The 3D world view. The same ledger projection as the map, drawn as an island:
//   one region per family, a platform per city, a building per department (taller = more agents),
//   the college dome at the centre, a KPI beacon, agents as small figures coloured by state,
//   and Security's jail holding every jailed agent. Hover or tap for details; click a city to open it.
import * as THREE from './vendor/three/three.module.min.js';
import { OrbitControls } from './vendor/three/OrbitControls.min.js';
import { h } from './dom.js';

const FAMILY_ORDER = ['revenue', 'claude', 'gemini', 'essentials'];
const FAMILY_LABEL = { revenue: 'Revenue', claude: 'Claude', gemini: 'Gemini', essentials: 'Essentials' };
const STATES = ['enrolled', 'student', 'probationer', 'active', 'senior'];
const ISLAND = 64;
const PLATFORM = 8;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function palette() {
  return {
    page: css('--page'),
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

/** Positions for n cities inside a family's quarter of the island, on arcs moving outward. */
function cityPositions(familyIndex, n) {
  const start = familyIndex * (Math.PI / 2) + Math.PI / 4 - Math.PI / 4;
  const out = [];
  let placed = 0;
  for (let ring = 0; placed < n; ring++) {
    const radius = 34 + ring * 21;
    const perRing = Math.max(1, Math.floor(((Math.PI / 2) * radius) / 23));
    const count = Math.min(perRing, n - placed);
    for (let k = 0; k < count; k++) {
      const a = start + ((k + 1) / (count + 1)) * (Math.PI / 2);
      out.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    placed += count;
  }
  return out;
}

export function mount3D(container, { onOpenCity }) {
  const canvasHost = h('div', { class: 'w3d-canvas', role: 'img', 'aria-label': 'Three-dimensional view of the world. Use the Map view for a readable list.' });
  const labels = h('div', { class: 'w3d-labels', 'aria-hidden': 'true' });
  const tip = h('div', { class: 'w3d-tip', role: 'status' });
  const HOME = new THREE.Vector3(0, 118, 122);
  // Narrow screens (phones) start further out so the whole island fits.
  const home = () => HOME.clone().multiplyScalar(Math.min(2.4, Math.max(1, 1.3 / (camera.aspect || 1))));
  const resetView = () => {
    camera.position.copy(home());
    controls.target.set(0, 0, 0);
  };
  const reset = h('button', { type: 'button', class: 'w3d-reset small-btn', onclick: resetView }, 'Reset view');
  container.replaceChildren(canvasHost, labels, tip, reset);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  canvasHost.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 20;
  controls.maxDistance = 320;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.target.set(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, far: 400 });
  scene.add(hemi, sun);

  let world = new THREE.Group();
  scene.add(world);
  /** Things that move each frame: { obj, center, radius, speed, phase, y } */
  let movers = [];
  /** HTML labels that follow 3D points. */
  let anchors = [];
  const pickables = [];

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let downAt = null;

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
    pickables.length = 0;
    labels.replaceChildren();
  }

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...extra });
  const pick = (mesh, info) => {
    mesh.userData.tip = info.tip;
    mesh.userData.cityId = info.cityId;
    pickables.push(mesh);
    return mesh;
  };
  const label = (text, sub, pos, cls = '') => {
    const el = h('div', { class: `w3d-label${cls ? ` w3d-${cls}` : ''}` }, h('b', {}, text), sub && h('span', {}, sub));
    labels.append(el);
    anchors.push({ el, pos });
  };

  function build(data) {
    disposeWorld();
    const pal = palette();
    scene.background = new THREE.Color(pal.page);
    scene.fog = new THREE.Fog(pal.page, 180, 420);

    // Island + family regions.
    const island = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND + 30, ISLAND + 34, 3, 96), mat(pal.surface2));
    island.position.y = -1.6;
    island.receiveShadow = true;
    world.add(island);
    FAMILY_ORDER.forEach((fam, i) => {
      const wedge = new THREE.Mesh(
        new THREE.CircleGeometry(ISLAND + 28, 48, i * (Math.PI / 2), Math.PI / 2 - 0.03),
        new THREE.MeshStandardMaterial({ color: pal.family[fam], transparent: true, opacity: 0.16, roughness: 1, side: THREE.DoubleSide }),
      );
      wedge.rotation.x = -Math.PI / 2;
      wedge.scale.y = -1; // CircleGeometry angles run clockwise once laid flat; mirror to match cityPositions.
      wedge.position.y = 0.02;
      wedge.receiveShadow = true;
      world.add(wedge);
      const a = i * (Math.PI / 2) + Math.PI / 4;
      const count = data.cities.filter((c) => c.family === fam).length;
      label(FAMILY_LABEL[fam], `${count} ${count === 1 ? 'city' : 'cities'}`, new THREE.Vector3(Math.cos(a) * (ISLAND + 22), 1, Math.sin(a) * (ISLAND + 22)), 'family');
    });

    const jailed = [];
    const now = Date.parse(data.now);
    const inJail = (a) => a.jail && (a.jail.status === 'awaiting_deletion' || Date.parse(a.jail.until) > now);
    let securityCenter = null;

    FAMILY_ORDER.forEach((fam, fi) => {
      const cities = data.cities.filter((c) => c.family === fam);
      const spots = cityPositions(fi, cities.length);
      cities.forEach((c, ci) => {
        const center = spots[ci];
        if (c.id === 'security-city') securityCenter = center;
        const cityGroup = new THREE.Group();
        cityGroup.position.copy(center);
        world.add(cityGroup);

        const kpiText = c.kpi ? `${c.kpi.metric.replaceAll('_', ' ')}: ${c.kpi.value}${c.kpi.target != null ? ` / ${c.kpi.target}` : ''}` : 'No KPI pulse yet';
        const platform = pick(new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM, PLATFORM + 0.6, 1.2, 6), mat(pal.surface)), {
          tip: `${c.name} · Mayor ${c.mayorName} · ${kpiText} · click to open`,
          cityId: c.id,
        });
        platform.position.y = 0.6;
        platform.receiveShadow = true;
        platform.castShadow = true;
        cityGroup.add(platform);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(PLATFORM + 0.3, 0.18, 6, 6), mat(pal.family[fam]));
        rim.rotation.x = Math.PI / 2;
        rim.rotation.z = Math.PI / 6;
        rim.position.y = 1.2;
        cityGroup.add(rim);

        // College: a dome at the centre; professors stand around it.
        const dome = pick(new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(pal.axis)), {
          tip: `${c.name} college · dean ${c.college.dean?.name ?? 'not appointed'} · ${c.college.professors.length} professor(s) · ${c.college.enrolled.length} new agent(s) waiting`,
          cityId: c.id,
        });
        dome.position.y = 1.2;
        dome.castShadow = true;
        cityGroup.add(dome);
        c.college.professors.forEach((p, k) => {
          const prof = pick(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 10), mat(pal.ink)), {
            tip: `Professor ${p.name} (${p.id})${p.steppedIn ? ` · stepping in: ${p.steppedIn.role}` : ' · teaching'}`,
            cityId: c.id,
          });
          const a = (k / Math.max(1, c.college.professors.length)) * Math.PI * 2;
          prof.position.set(Math.cos(a) * 2.3, 1.65, Math.sin(a) * 2.3);
          prof.castShadow = true;
          cityGroup.add(prof);
        });
        c.college.enrolled.forEach((a, k) => {
          const fig = figure(pal.state[0], `${a.name} (${a.id}) · enrolled at the college`, c.id);
          const ang = Math.PI / 4 + k * 0.5;
          fig.position.set(Math.cos(ang) * 3.1, 1.2, Math.sin(ang) * 3.1);
          cityGroup.add(fig);
        });

        // Departments: a building each, around the college.
        const depts = c.districts.flatMap((d) => d.departments.map((dp) => ({ dp, d })));
        depts.forEach(({ dp, d }, k) => {
          const a = (k / Math.max(1, depts.length)) * Math.PI * 2 + Math.PI / 6;
          const pos = new THREE.Vector3(Math.cos(a) * 4.9, 0, Math.sin(a) * 4.9);
          const heightB = 1.2 + dp.graduatedCount * 0.9 + (dp.agents.length - dp.graduatedCount) * 0.3;
          const building = pick(new THREE.Mesh(new THREE.BoxGeometry(1.6, heightB, 1.6), mat(pal.surface2)), {
            tip: `${dp.name} (${d.name}) · ${dp.graduatedCount} working${dp.maxGraduated != null ? ` of ${dp.maxGraduated}` : ''} · ${dp.shadowCount} shadow(s) · ${dp.agents.length} total`,
            cityId: c.id,
          });
          building.position.set(pos.x, 1.2 + heightB / 2, pos.z);
          building.castShadow = true;
          building.receiveShadow = true;
          cityGroup.add(building);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 1.7), mat(pal.family[fam]));
          roof.position.set(pos.x, 1.2 + heightB + 0.09, pos.z);
          cityGroup.add(roof);
          if (dp.openRoleRequests.length) {
            const flag = pick(new THREE.Mesh(new THREE.OctahedronGeometry(0.35), mat(pal.serious, { emissive: pal.serious, emissiveIntensity: 0.4 })), {
              tip: `${dp.name}: ${dp.openRoleRequests.length} unfilled role(s)`,
              cityId: c.id,
            });
            flag.position.set(pos.x, 1.2 + heightB + 0.8, pos.z);
            cityGroup.add(flag);
            movers.push({ obj: flag, spin: true });
          }

          dp.agents.forEach((ag, j) => {
            if (inJail(ag)) {
              jailed.push({ ag, city: c });
              return;
            }
            const color = pal.state[STATES.indexOf(ag.state)] ?? pal.deemph;
            const status = ag.status?.status ?? 'idle';
            const fig = figure(color, `${ag.name} (${ag.id}) · ${ag.state}${ag.badges.length ? ` · ${ag.badges.join(', ')}` : ''} · ${status}${ag.status?.activity ? `: ${ag.status.activity}` : ''}`, c.id);
            const radius = 1.35 + (j % 3) * 0.25;
            const phase = (j / Math.max(1, dp.agents.length)) * Math.PI * 2;
            fig.position.set(pos.x + Math.cos(phase) * radius, 1.2, pos.z + Math.sin(phase) * radius);
            cityGroup.add(fig);
            if (status === 'working') movers.push({ obj: fig, center: pos, radius, phase, speed: 0.35 + (j % 4) * 0.07, y: 1.2 });
          });
        });

        // KPI beacon: height follows value / target; the top says on target (good) or below (critical).
        const ratio = c.kpi && c.kpi.target ? Math.min(c.kpi.value / c.kpi.target, 1.5) : 0.25;
        const beaconH = 1.5 + ratio * 4;
        const onTarget = c.kpi && c.kpi.target != null && c.kpi.value >= c.kpi.target;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, beaconH, 8), mat(pal.axis));
        pole.position.set(PLATFORM - 1.2, 1.2 + beaconH / 2, 0);
        cityGroup.add(pole);
        const lamp = pick(new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), mat(c.kpi ? (onTarget ? pal.good : pal.critical) : pal.deemph, { emissive: c.kpi ? (onTarget ? pal.good : pal.critical) : 0x000000, emissiveIntensity: 0.6 })), {
          tip: `${c.name} KPI · ${kpiText}${c.kpi?.target != null ? (onTarget ? ' · on target' : ' · below target') : ''}`,
          cityId: c.id,
        });
        lamp.position.set(PLATFORM - 1.2, 1.2 + beaconH + 0.3, 0);
        cityGroup.add(lamp);

        label(c.name, `Mayor ${c.mayorName}`, new THREE.Vector3(center.x, 11, center.z), 'city');
      });
    });

    // Security's jail: a cage holding every jailed agent, from any city.
    // Next to Security City, on the side facing the sea; at the island's centre if there is no Security City.
    const cagePos = securityCenter ? securityCenter.clone().add(securityCenter.clone().normalize().multiplyScalar(PLATFORM + 5)) : new THREE.Vector3();
    const cage = pick(new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 4.5), new THREE.MeshBasicMaterial({ color: pal.critical, wireframe: true })), {
      tip: `Security jail · ${jailed.length} inside`,
      cityId: securityCenter ? 'security-city' : undefined,
    });
    cage.position.set(cagePos.x, 1.5, cagePos.z);
    world.add(cage);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.2, 4.5), mat(pal.surface2));
    floor.position.set(cagePos.x, 0.1, cagePos.z);
    world.add(floor);
    jailed.forEach(({ ag, city }, k) => {
      const until = ag.jail.status === 'awaiting_deletion' ? 'awaiting deletion' : `until ${new Date(ag.jail.until).toLocaleString()}`;
      const fig = figure(pal.critical, `${ag.name} (${ag.id}) of ${city.name} · in jail, ${until}`, 'security-city');
      fig.position.set(cagePos.x - 1.3 + (k % 3) * 1.3, 0.2, cagePos.z - 1.3 + Math.floor(k / 3) * 1.3);
      world.add(fig);
    });
    label('Jail', `${jailed.length} inside`, new THREE.Vector3(cagePos.x, 3.6, cagePos.z), 'jail');
  }

  function figure(color, tipText, cityId) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), mat(color));
    body.position.y = 0.45;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat(color));
    head.position.y = 0.95;
    g.add(body, head);
    pick(body, { tip: tipText, cityId });
    pick(head, { tip: tipText, cityId });
    return g;
  }

  // ---------- interaction ----------
  function setPointer(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0]?.object ?? null;
    hovered = hit;
    if (hit) {
      tip.textContent = hit.userData.tip;
      tip.classList.add('on');
      tip.style.left = `${ev.clientX - r.left + 14}px`;
      tip.style.top = `${ev.clientY - r.top + 14}px`;
      renderer.domElement.style.cursor = hit.userData.cityId ? 'pointer' : 'default';
    } else {
      tip.classList.remove('on');
      renderer.domElement.style.cursor = 'grab';
    }
  }
  renderer.domElement.addEventListener('pointermove', setPointer);
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    downAt = [ev.clientX, ev.clientY];
    setPointer(ev);
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    // A click (not a drag) on a city opens it.
    if (downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) < 6) {
      setPointer(ev);
      if (hovered?.userData.cityId) onOpenCity(hovered.userData.cityId);
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
    if (!framed) {
      framed = true;
      resetView();
    }
  }
  let framed = false;
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const v = new THREE.Vector3();
  const timer = new THREE.Timer();
  let frame = 0;
  function loop() {
    frame = requestAnimationFrame(loop);
    if (document.hidden || !container.isConnected) return;
    timer.update();
    const t = timer.getElapsed();
    if (!reducedMotion()) {
      for (const m of movers) {
        if (m.spin) {
          m.obj.rotation.y = t * 1.5;
          continue;
        }
        const a = m.phase + t * m.speed;
        m.obj.position.set(m.center.x + Math.cos(a) * m.radius, m.y, m.center.z + Math.sin(a) * m.radius);
      }
    }
    controls.update();
    renderer.render(scene, camera);
    const w = container.clientWidth;
    const hgt = container.clientHeight;
    for (const { el, pos } of anchors) {
      v.copy(pos).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.display = visible ? '' : 'none';
      if (visible) el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px)`;
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
