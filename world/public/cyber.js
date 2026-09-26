// The cyberpunk kit shared by the 3D city and the globe: a night palette, lit-window facades, people
// with a walk cycle, detailed towers with neon signs, roads, cars, flying cars, streetlights and a
// skyline filler. Shared geometries, materials and textures are built once and marked `keep`, so a
// live rebuild of a scene never re-creates them.
import * as THREE from './vendor/three-r186/three.module.min.js';
import { rng } from './geo.js';

export const NEON = {
  cyan: '#19f0ff',
  magenta: '#ff2bd6',
  violet: '#9b5cff',
  amber: '#ffb31a',
  lime: '#b6ff3b',
  red: '#ff3355',
  white: '#e8f6ff',
};
/** One neon hue per district, in order. */
export const NEON_SET = [NEON.cyan, NEON.magenta, NEON.amber, NEON.violet, NEON.lime, '#ff7a2b'];
export const NIGHT = { fog: '#140a26', ground: '#07080f', asphalt: '#171824', facade: '#141827', roof: '#0c0e17', metal: '#2a2d3d' };

const keep = (x) => {
  x.userData.keep = true;
  return x;
};

/** Dispose a scene subtree, skipping the shared (kept) geometries, materials and textures. */
export function disposeTree(root) {
  root.traverse((o) => {
    // Instanced meshes hold per-instance GPU buffers that only their own dispose() frees.
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (m.userData.keep) continue;
      if (m.map && !m.map.userData.keep) m.map.dispose();
      m.dispose();
    }
  });
}

// ---------- materials ----------
const matCache = new Map();
function cached(key, make) {
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = keep(make())));
  return m;
}
/** A lit surface. */
export const solid = (color, { rough = 0.7, metal = 0.2, glow = 0 } = {}) =>
  cached(`s|${color}|${rough}|${metal}|${glow}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: glow ? color : '#000000', emissiveIntensity: glow }));
/** A neon tube or light: always full brightness, unaffected by the night. */
export const neon = (color, opacity = 1) =>
  cached(`n|${color}|${opacity}`, () => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
/** An invisible hit box: raycasts, never draws. */
export const HIT = keep(new THREE.MeshBasicMaterial({ visible: false }));

function canvasTexture(w, hgt, paint, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  paint(c.getContext('2d'), w, hgt);
  const t = keep(new THREE.CanvasTexture(c));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

let glowTex = null;
/** Soft round glow, for lamps and beacons (additive sprites stand in for bloom). */
export function glowTexture() {
  glowTex ??= canvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  return glowTex;
}
export function glow(color, size, opacity = 0.85) {
  const s = new THREE.Sprite(cached(`g|${color}|${opacity}`, () => new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })));
  s.scale.set(size, size, 1);
  return s;
}

let skyTex = null;
/** Night sky: near-black overhead, a violet-magenta city glow at the horizon. */
export function skyTexture() {
  skyTex ??= canvasTexture(4, 256, (ctx, w, hgt) => {
    const g = ctx.createLinearGradient(0, 0, 0, hgt);
    g.addColorStop(0, '#03020a');
    g.addColorStop(0.55, '#120828');
    g.addColorStop(0.8, '#3a1256');
    g.addColorStop(1, '#5c1a5e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hgt);
  });
  return skyTex;
}

let groundTex = null;
/** Dark ground with a faint cyan survey grid. */
export function groundTexture() {
  groundTex ??= canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = NIGHT.ground;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(25,240,255,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(155,92,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(64, 0);
    ctx.lineTo(64, 128);
    ctx.moveTo(0, 64);
    ctx.lineTo(128, 64);
    ctx.stroke();
  }, { repeat: true });
  return groundTex;
}

let dashTex = null;
function dashTexture() {
  dashTex ??= canvasTexture(8, 64, (ctx) => {
    ctx.clearRect(0, 0, 8, 64);
    ctx.fillStyle = '#ffd36b';
    ctx.fillRect(0, 0, 8, 30);
  }, { repeat: true });
  return dashTex;
}

// ---------- facades ----------
const WINDOW_COLS = 8;
const FLOOR = 1.2; // world units per floor
const facadeSets = [];
/** Lit-window facade textures in a few moods; the same image drives colour and glow. */
function facadeTexture(variant) {
  return canvasTexture(256, 256, (ctx) => {
    const rand = rng(`facade${variant}`);
    ctx.fillStyle = '#0b0d17';
    ctx.fillRect(0, 0, 256, 256);
    const warm = ['#ffd9a0', '#ffe9c4', '#fff3dd'];
    const cool = ['#9fe8ff', '#c7f4ff', '#7ad7ff'];
    const pink = ['#ff9ef0', '#ffc2f6'];
    const moods = [cool, warm, pink, cool];
    const mood = moods[variant % moods.length];
    for (let row = 0; row < 8; row++) {
      const floorLit = rand() < 0.78;
      for (let col = 0; col < WINDOW_COLS; col++) {
        const lit = floorLit && rand() < 0.62;
        ctx.fillStyle = lit ? mood[Math.floor(rand() * mood.length)] : rand() < 0.5 ? '#1a2033' : '#141827';
        ctx.globalAlpha = lit ? 0.55 + rand() * 0.45 : 1;
        ctx.fillRect(col * 32 + 5, row * 32 + 6, 22, 20);
        ctx.globalAlpha = 1;
      }
    }
  }, { repeat: true });
}
/** Box materials: windows on the four sides, a dark roof and floor. */
export function facade(variant = 0) {
  const v = variant % 4;
  if (!facadeSets[v]) {
    const tex = facadeTexture(v);
    const side = keep(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.95, roughness: 0.55, metalness: 0.35 }));
    const roof = solid(NIGHT.roof, { rough: 0.9, metal: 0.1 });
    facadeSets[v] = [side, side, roof, roof, side, side];
  }
  return facadeSets[v];
}

/** Stretch a box's UVs so windows keep their real size on any building. */
export function facadeBox(w, hgt, d) {
  const geo = new THREE.BoxGeometry(w, hgt, d);
  const uv = geo.attributes.uv;
  // Face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const sizes = [[d, hgt], [d, hgt], [w, d], [w, d], [w, hgt], [w, hgt]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = sizes[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * fu) / WINDOW_COLS, (uv.getY(i) * fv) / (8 * FLOOR));
    }
  }
  return geo;
}

/** A sign's canvas texture: neon text on a dark glass panel. */
function signTexture(text, color, vertical = false) {
  const chars = [...text];
  const w = vertical ? 64 : Math.min(1024, Math.max(128, chars.length * 34 + 40));
  const hgt = vertical ? Math.max(64, chars.length * 56 + 24) : 72;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(8,6,20,0.82)';
  ctx.fillRect(0, 0, w, hgt);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, w - 6, hgt - 6);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.font = '700 44px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (vertical) chars.forEach((ch, i) => ctx.fillText(ch, w / 2, 40 + i * 56));
  else ctx.fillText(text, w / 2, hgt / 2 + 2, w - 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { texture: t, aspect: w / hgt };
}

/** A neon sign plane (its own texture; disposed with the scene). */
export function sign(text, color, height, { vertical = false, maxWidth = Infinity } = {}) {
  const { texture, aspect } = signTexture(text, color, vertical);
  let hgt = height;
  let w = height * aspect;
  if (w > maxWidth) {
    w = maxWidth;
    hgt = w / aspect;
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }));
  m.userData.size = { w, h: hgt };
  return m;
}

const BOX = keep(new THREE.BoxGeometry(1, 1, 1));
const CYL = keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 8));
const BALL = keep(new THREE.SphereGeometry(0.5, 12, 8));

function piece(geo, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

/**
 * A detailed tower: stepped tiers with lit windows, neon corner strips and ledges, rooftop plant and an
 * antenna with a blinking light, and optional signs. Faces +z. Returns { group, hit, top, blinkers }.
 */
export function tower({ w = 4, d = 4, h: height = 10, accent = NEON.cyan, seed = 'x', label = null, blade = null, detail = true }) {
  const rand = rng(seed);
  const g = new THREE.Group();
  const mats = facade(Math.floor(rand() * 4));
  const tiers = height < 5 || !detail ? [[1, 1]] : height < 12 ? [[1, 0.7], [0.74, 0.3]] : [[1, 0.55], [0.78, 0.28], [0.5, 0.17]];
  let y = 0;
  const neonMat = neon(accent);
  tiers.forEach(([k, share], i) => {
    const tw = w * k;
    const td = d * k;
    const th = height * share;
    const body = new THREE.Mesh(facadeBox(tw, th, td), mats);
    body.position.y = y + th / 2;
    g.add(body);
    if (detail) {
      // Ledge at the top of each tier, and neon strips up the corners of the base.
      for (const [x, z, sx, sz] of [[0, td / 2, tw + 0.1, 0.1], [0, -td / 2, tw + 0.1, 0.1], [tw / 2, 0, 0.1, td], [-tw / 2, 0, 0.1, td]]) g.add(piece(BOX, neonMat, sx, 0.1, sz, x, y + th, z));
      if (i === 0) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(piece(BOX, neonMat, 0.07, th, 0.07, (sx * tw) / 2, y + th / 2, (sz * td) / 2));
    }
    y += th;
  });
  const top = y;
  const blinkers = [];
  if (detail) {
    const topW = w * tiers[tiers.length - 1][0];
    // Rooftop plant.
    g.add(piece(BOX, solid(NIGHT.metal, { metal: 0.6, rough: 0.4 }), topW * 0.35, 0.45, topW * 0.3, -topW * 0.18, top + 0.22, topW * 0.12));
    const antH = 1.2 + rand() * 2.2;
    g.add(piece(CYL, solid('#565b70', { metal: 0.8, rough: 0.3 }), 0.08, antH, 0.08, topW * 0.22, top + antH / 2, -topW * 0.15));
    const lamp = piece(BALL, neon(NEON.red), 0.2, 0.2, 0.2, topW * 0.22, top + antH + 0.1, -topW * 0.15);
    const halo = glow(NEON.red, 1.4, 0.7);
    halo.position.copy(lamp.position);
    g.add(lamp, halo);
    lamp.userData.dynamic = halo.userData.dynamic = true;
    blinkers.push(lamp, halo);
  }
  if (label) {
    const s = sign(label.toUpperCase(), accent, 0.75, { maxWidth: w * 0.95 });
    s.position.set(0, Math.min(height * 0.45, 3.2), d / 2 + 0.06);
    g.add(s);
  }
  if (blade) {
    // A vertical blade sign sticking out from the right-hand wall, readable from the front.
    const s = sign(blade.toUpperCase().slice(0, 6), NEON_SET[Math.floor(rand() * NEON_SET.length)], Math.min(height * 0.5, 5.5), { vertical: true });
    s.position.set(w / 2 + s.userData.size.w / 2 + 0.05, height * 0.55, d / 2 - 0.3);
    g.add(s);
  }
  const hit = new THREE.Mesh(BOX, HIT);
  hit.scale.set(w, top, d);
  hit.position.y = top / 2;
  g.add(hit);
  return { group: g, hit, top, blinkers };
}

// ---------- people ----------
const SKIN = ['#f1c7a5', '#d9a47c', '#b57a55', '#8a5638', '#5e3a24', '#f5d6c0'];
const HAIR = ['#141018', '#3a2517', '#6b4a2e', '#d8d2c8', NEON.magenta, NEON.cyan, '#a64dff', '#1d1d2a'];
let P = null;
function personGeos() {
  if (P) return P;
  const capsule = (r, len, drop) => new THREE.CapsuleGeometry(r, len, 3, 8).translate(0, drop ? -(len / 2 + r) : 0, 0);
  P = {
    head: (new THREE.SphereGeometry(0.13, 14, 10)),
    hair: (new THREE.SphereGeometry(0.138, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)),
    neck: (new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8)),
    torso: capsule(0.16, 0.3, false),
    hips: (new THREE.BoxGeometry(0.31, 0.14, 0.19)),
    arm: capsule(0.055, 0.42, true),
    leg: capsule(0.075, 0.62, true),
    hand: (new THREE.SphereGeometry(0.052, 8, 6)),
    shoe: (new THREE.BoxGeometry(0.12, 0.07, 0.24)),
    visor: (new THREE.BoxGeometry(0.2, 0.045, 0.07)),
    stripe: (new THREE.BoxGeometry(0.035, 0.34, 0.02)),
    cap: (new THREE.BoxGeometry(0.34, 0.03, 0.34)),
    capBase: (new THREE.CylinderGeometry(0.12, 0.13, 0.08, 10)),
    hit: keep(new THREE.BoxGeometry(0.55, 1.85, 0.45).translate(0, 0.92, 0)),
  };
  // Merged per person, so kept non-indexed.
  for (const k of Object.keys(P)) if (k !== 'hit') P[k] = keep(P[k].index ? P[k].toNonIndexed() : P[k]);
  return P;
}

/**
 * A person, about 1.8 units tall, facing +z. The jacket carries the agent's tier colour; the rest
 * (skin, hair, neon visor) varies by seed. Built as six meshes (body, neon trim, two arms, two legs)
 * so a crowd stays cheap to draw. Returns { group, hit, rig } — animate with `animatePerson`.
 */
export function person({ jacket, seed = 'p', accent = NEON.cyan, cap = null }) {
  const G = personGeos();
  const rand = rng(seed);
  const skin = SKIN[Math.floor(rand() * SKIN.length)];
  const hair = HAIR[Math.floor(rand() * HAIR.length)];
  const pants = '#1a1b28';
  const shoes = '#0a0a10';
  const e = new THREE.Euler();
  const part = (geo, color, x, y, z, { sx = 1, sy = 1, sz = 1, rx = 0, ry = 0 } = {}) => ({
    g: geo,
    start: 0,
    count: geo.attributes.position.count,
    m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e.set(rx, ry, 0)), new THREE.Vector3(sx, sy, sz)),
    color: new THREE.Color(color),
  });
  const lit = cached('person', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }));
  const glowing = cached('person-neon', () => new THREE.MeshBasicMaterial({ vertexColors: true }));

  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const bodyParts = [
    part(G.hips, pants, 0, 0.88, 0),
    part(G.torso, jacket, 0, 1.22, 0, { sx: 1.12, sz: 0.72 }),
    part(G.neck, skin, 0, 1.56, 0),
    part(G.head, skin, 0, 1.69, 0),
    part(G.hair, hair, 0, 1.705, 0, { rx: -0.25 }),
  ];
  const neonParts = [part(G.stripe, accent, 0.06, 1.24, 0.12)];
  if (rand() < 0.55) neonParts.push(part(G.visor, rand() < 0.5 ? NEON.cyan : NEON.magenta, 0, 1.71, 0.1));
  if (cap) {
    bodyParts.push(part(G.capBase, '#111018', 0, 1.8, 0));
    neonParts.push(part(G.cap, cap, 0, 1.85, 0, { ry: Math.PI / 4 }));
  }
  body.add(new THREE.Mesh(mergeParts(bodyParts, { color: true }), lit), new THREE.Mesh(mergeParts(neonParts, { color: true }), glowing));

  const limb = (parts, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(new THREE.Mesh(mergeParts(parts, { color: true }), lit));
    body.add(pivot);
    return pivot;
  };
  const leg = () => [part(G.leg, pants, 0, 0, 0), part(G.shoe, shoes, 0, -0.78, 0.04)];
  const arm = () => [part(G.arm, jacket, 0, 0, 0), part(G.hand, skin, 0, -0.56, 0)];
  const legL = limb(leg(), 0.085, 0.82);
  const legR = limb(leg(), -0.085, 0.82);
  const armL = limb(arm(), 0.215, 1.44);
  const armR = limb(arm(), -0.215, 1.44);
  armL.rotation.z = 0.06;
  armR.rotation.z = -0.06;

  const hit = new THREE.Mesh(G.hit, HIT);
  g.add(hit);
  return { group: g, hit, rig: { body, legL, legR, armL, armR, phase: rand() * Math.PI * 2 } };
}

/** Walk cycle (or idle sway) at time `t` seconds. */
export function animatePerson(rig, t, walking) {
  if (walking) {
    const s = Math.sin(t * 7 + rig.phase);
    rig.legL.rotation.x = s * 0.6;
    rig.legR.rotation.x = -s * 0.6;
    rig.armL.rotation.x = -s * 0.5;
    rig.armR.rotation.x = s * 0.5;
    rig.body.position.y = Math.abs(Math.cos(t * 7 + rig.phase)) * 0.035;
  } else {
    const s = Math.sin(t * 1.3 + rig.phase);
    rig.legL.rotation.x = rig.legR.rotation.x = 0;
    rig.armL.rotation.x = s * 0.06;
    rig.armR.rotation.x = -s * 0.06;
    rig.body.position.y = 0;
    rig.body.rotation.y = s * 0.12;
  }
}

// ---------- roads, cars, lights ----------
const Z = new THREE.Vector3(0, 0, 1);
/** Orient a group so local +z runs from a to b, centred between them. */
function span(obj, a, b) {
  obj.position.copy(a).add(b).multiplyScalar(0.5);
  obj.quaternion.setFromUnitVectors(Z, b.clone().sub(a).normalize());
}

/** A street from a to b: asphalt, a dashed centre line and faint neon kerbs. `deck` raises it on a thick slab. */
export function road(a, b, { width = 3, lines = true, kerb = NEON.cyan, deck = 0 } = {}) {
  const L = a.distanceTo(b);
  const g = new THREE.Group();
  const slab = deck || 0.06;
  g.add(piece(BOX, solid(NIGHT.asphalt, { rough: 0.95, metal: 0.05 }), width, slab, L, 0, -slab / 2 + 0.03, 0));
  if (lines) {
    const dashes = new THREE.PlaneGeometry(0.14, L);
    const uv = dashes.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) * L) / 2.4);
    const m = new THREE.Mesh(dashes, cached('dash', () => new THREE.MeshBasicMaterial({ map: dashTexture(), transparent: true })));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.045;
    g.add(m);
  }
  const kerbMat = neon(kerb, deck ? 1 : 0.55);
  for (const side of [-1, 1]) g.add(piece(BOX, kerbMat, 0.08, deck ? 0.35 : 0.03, L, (side * width) / 2, deck ? 0.2 : 0.04, 0));
  span(g, a, b);
  return g;
}

/** A car facing +z: metallic body, dark glass, headlights, tail lights, neon underglow. */
export function car(seed, { flying = false } = {}) {
  const rand = rng(seed);
  const paint = ['#1b1e2e', '#2b0f3a', '#0f2a36', '#3a3f55', '#521021', '#0d0d12'][Math.floor(rand() * 6)];
  const under = NEON_SET[Math.floor(rand() * NEON_SET.length)];
  const g = new THREE.Group();
  g.add(piece(BOX, solid(paint, { metal: 0.8, rough: 0.25 }), 0.9, 0.3, 1.9, 0, 0.33, 0));
  g.add(piece(BOX, solid('#070812', { metal: 0.9, rough: 0.1 }), 0.78, 0.26, 0.95, 0, 0.6, -0.1));
  const head = neon('#f4fbff');
  const tail = neon(NEON.red);
  for (const x of [-0.3, 0.3]) {
    g.add(piece(BOX, head, 0.2, 0.08, 0.04, x, 0.38, 0.96));
    g.add(piece(BOX, tail, 0.22, 0.07, 0.04, x, 0.4, -0.96));
  }
  g.add(piece(BOX, neon(under, 0.7), 0.95, 0.02, 1.8, 0, 0.1, 0));
  if (flying) {
    for (const x of [-0.5, 0.5]) g.add(piece(CYL, neon(under), 0.28, 0.1, 0.28, x, 0.2, -0.7));
    const trail = glow(under, 2.4, 0.6);
    trail.position.set(0, 0.2, -1.2);
    g.add(trail);
  }
  return g;
}

/** A streetlight: pole, arm, and a coloured glow. */
export function streetlight(color) {
  const g = new THREE.Group();
  const pole = solid('#3a3e52', { metal: 0.7, rough: 0.35 });
  g.add(piece(CYL, pole, 0.12, 4, 0.12, 0, 2, 0));
  g.add(piece(BOX, pole, 0.08, 0.08, 1.1, 0, 4, 0.5));
  g.add(piece(BOX, neon(color), 0.3, 0.06, 0.4, 0, 3.95, 1));
  const halo = glow(color, 3.2, 0.55);
  halo.position.set(0, 3.8, 1);
  g.add(halo);
  return g;
}

// ---------- skyline filler ----------
const SKYLINE_WORDS = ['NEURAL', 'SYNTH', 'NEXUS', 'FLUX', 'ZERO', 'DATA', '24/7', 'NOVA', 'ECHO', 'VOLT'];
/**
 * Background city blocks as instanced towers (a handful of draw calls for hundreds of buildings), with
 * neon crowns on some and a few big billboards. `spots` is [{ x, z, w, d, h }].
 */
export function skyline(spots, seed = 'sky', { billboards = 12, footprintY = 0, crownShare = 0.3 } = {}) {
  const g = new THREE.Group();
  if (!spots.length) return g;
  const rand = rng(seed);
  const unit = facadeBox(4, 16, 4).translate(0, 8, 0);
  const byVariant = [[], [], [], []];
  spots.forEach((s) => byVariant[Math.floor(rand() * 4)].push(s));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const crowns = [];
  byVariant.forEach((list, v) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(unit, facade(v), list.length);
    list.forEach((s, i) => {
      m4.compose(new THREE.Vector3(s.x, footprintY, s.z), q, new THREE.Vector3(s.w / 4, s.h / 16, s.d / 4));
      inst.setMatrixAt(i, m4);
      if (rand() < crownShare) crowns.push(s);
    });
    g.add(inst);
  });
  if (crowns.length) {
    // Neon trim around the roof edge: four thin bars per crowned block.
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), crowns.length * 4);
    const col = new THREE.Color();
    let i = 0;
    for (const s of crowns) {
      col.set(NEON_SET[Math.floor(rand() * NEON_SET.length)]);
      const y = footprintY + s.h + 0.05;
      for (const [x, z, sx, sz] of [[0, s.d / 2, s.w, 0.12], [0, -s.d / 2, s.w, 0.12], [s.w / 2, 0, 0.12, s.d], [-s.w / 2, 0, 0.12, s.d]]) {
        m4.compose(new THREE.Vector3(s.x + x, y, s.z + z), q, new THREE.Vector3(sx + 0.1, 0.12, sz + 0.1));
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i++, col);
      }
    }
    g.add(inst);
  }
  // A few big billboards on the tallest blocks.
  [...spots].sort((a, b) => b.h - a.h).slice(0, billboards).forEach((s, i) => {
    const word = SKYLINE_WORDS[Math.floor(rand() * SKYLINE_WORDS.length)];
    const b = sign(word, NEON_SET[i % NEON_SET.length], Math.max(2, s.h * 0.12), { maxWidth: s.w * 1.4 });
    // Face the city centre.
    const face = Math.atan2(-s.x, -s.z);
    b.rotation.y = face;
    const off = Math.max(s.w, s.d) / 2 + 0.1;
    b.position.set(s.x + Math.sin(face) * off, footprintY + s.h * 0.72, s.z + Math.cos(face) * off);
    g.add(b);
  });
  return g;
}

// ---------- performance: static batching and instanced traffic ----------
const _m3 = new THREE.Matrix3();
const _v = new THREE.Vector3();

/** One non-indexed geometry from parts: { g (non-indexed), start, count, m (Matrix4), color? }. */
function mergeParts(parts, { color = false } = {}) {
  let total = 0;
  for (const p of parts) total += p.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const col = color ? new Float32Array(total * 3) : null;
  let o = 0;
  for (const p of parts) {
    _m3.getNormalMatrix(p.m);
    const P = p.g.attributes.position;
    const N = p.g.attributes.normal;
    const U = p.g.attributes.uv;
    for (let i = p.start; i < p.start + p.count; i++, o++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(p.m);
      pos[o * 3] = _v.x;
      pos[o * 3 + 1] = _v.y;
      pos[o * 3 + 2] = _v.z;
      if (N) {
        _v.fromBufferAttribute(N, i).applyMatrix3(_m3).normalize();
        nor[o * 3] = _v.x;
        nor[o * 3 + 1] = _v.y;
        nor[o * 3 + 2] = _v.z;
      }
      if (U) {
        uvs[o * 2] = U.getX(i);
        uvs[o * 2 + 1] = U.getY(i);
      }
      if (col) {
        col[o * 3] = p.color.r;
        col[o * 3 + 1] = p.color.g;
        col[o * 3 + 2] = p.color.b;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Merge every static mesh under `root` that shares a material into one mesh per material, so a city
 * draws in tens of calls instead of thousands. Skips anything flagged `userData.dynamic` (people,
 * blinking or spinning parts), anything in `skip` (pickable meshes), hit boxes, sprites and instanced
 * meshes. A material used by only one mesh is left alone (e.g. per-district pads that get dimmed).
 */
export function bakeStatic(root, skip = new Set()) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map();
  const meshes = [];
  const walk = (o) => {
    if (o.userData.dynamic || skip.has(o)) return;
    if (o.isMesh && !o.isInstancedMesh && o.material !== HIT && o.visible) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      const m = inv.clone().multiply(o.matrixWorld);
      const entry = { mesh: o, g, parts: [] };
      const add = (mat, start, count) => {
        const part = { g, start, count, m, entry };
        entry.parts.push({ mat, part });
        if (!buckets.has(mat)) buckets.set(mat, []);
        buckets.get(mat).push(part);
      };
      if (Array.isArray(o.material)) {
        for (const grp of g.groups) add(o.material[grp.materialIndex], grp.start, Math.min(grp.count, g.attributes.position.count - grp.start));
      } else add(o.material, 0, g.attributes.position.count);
      meshes.push(entry);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  const merged = new Set();
  for (const [mat, parts] of buckets) {
    if (parts.length < 2) continue;
    const mesh = new THREE.Mesh(mergeParts(parts), mat);
    mesh.userData.baked = true;
    root.add(mesh);
    merged.add(mat);
  }
  for (const e of meshes) {
    if (e.g !== e.mesh.geometry) e.g.dispose();
    if (!e.parts.every((p) => merged.has(p.mat))) continue;
    e.mesh.parent?.remove(e.mesh);
    if (!e.mesh.geometry.userData.keep) e.mesh.geometry.dispose();
  }
}

let carGeos = null;
function carGeometries() {
  if (carGeos) return carGeos;
  const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const part = (sx, sy, sz, x, y, z, color) => ({ g: box, start: 0, count: box.attributes.position.count, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)), color: new THREE.Color(color) });
  // Body parts are white (tinted per car by instance colour); the cabin stays dark glass.
  const body = mergeParts([part(0.9, 0.3, 1.9, 0, 0.33, 0, '#ffffff'), part(0.78, 0.26, 0.95, 0, 0.6, -0.1, '#0b0c16')], { color: true });
  const lights = mergeParts([
    part(0.2, 0.08, 0.04, -0.3, 0.38, 0.96, '#f4fbff'), part(0.2, 0.08, 0.04, 0.3, 0.38, 0.96, '#f4fbff'),
    part(0.22, 0.07, 0.04, -0.3, 0.4, -0.96, NEON.red), part(0.22, 0.07, 0.04, 0.3, 0.4, -0.96, NEON.red),
  ], { color: true });
  const under = mergeParts([part(0.95, 0.02, 1.8, 0, 0.1, 0, '#ffffff')]);
  carGeos = { body: keep(body), lights: keep(lights), under: keep(under) };
  return carGeos;
}

/**
 * All the cars in a scene as three instanced meshes (body, lights, neon underglow): three draw calls
 * however many cars. `place(i, position, yaw)` then `commit()` each frame.
 */
export function fleet(count, seed = 'fleet') {
  const G = carGeometries();
  const rand = rng(seed);
  const group = new THREE.Group();
  const body = new THREE.InstancedMesh(G.body, cached('car-body', () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.3 })), count);
  const lights = new THREE.InstancedMesh(G.lights, cached('car-lights', () => new THREE.MeshBasicMaterial({ vertexColors: true })), count);
  const under = new THREE.InstancedMesh(G.under, cached('car-under', () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7 })), count);
  const paints = ['#2a2f48', '#4a1a62', '#15475a', '#5a6078', '#7a1a33', '#1a1a22'];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    body.setColorAt(i, c.set(paints[Math.floor(rand() * paints.length)]));
    under.setColorAt(i, c.set(NEON_SET[Math.floor(rand() * NEON_SET.length)]));
  }
  for (const m of [body, lights, under]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  return {
    group,
    place(i, pos, yaw, pitch = 0) {
      q.setFromAxisAngle(up, yaw);
      if (pitch) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
      m4.compose(pos, q, one);
      body.setMatrixAt(i, m4);
      lights.setMatrixAt(i, m4);
      under.setMatrixAt(i, m4);
    },
    commit() {
      body.instanceMatrix.needsUpdate = lights.instanceMatrix.needsUpdate = under.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- renderer health ----------
/**
 * A renderer tuned for laptops. Pixel ratio starts at 1.5 at most and drops to 1 by itself when frames
 * run slow. If the graphics driver resets (WebGL context lost), the view pauses with a notice, then
 * rebuilds itself at the lighter setting when the browser restores the context. After three resets in
 * five minutes it stops retrying and says so, rather than flickering on and off.
 * Returns { renderer, isLost(), tick(now) } — call tick once per rendered frame.
 */
export function makeRenderer(container, { onResize = () => {}, onRestore = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  let ratio = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(ratio);
  let lost = false;
  let givenUp = false;
  const losses = [];
  const notice = document.createElement('div');
  notice.className = 'w3d-lost';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const text = document.createElement('p');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'small-btn primary';
  retry.textContent = 'Reload the page';
  retry.addEventListener('click', () => location.reload());
  notice.append(text, retry);
  container.append(notice);
  const RESTART = 'Fully quit the browser (Cmd+Q on a Mac) and open it again; browsers switch 3D off for a page after repeated graphics resets. The Map and Details views have everything meanwhile.';
  const lower = () => {
    if (ratio <= 1) return;
    ratio = 1;
    renderer.setPixelRatio(ratio);
    onResize();
  };
  renderer.domElement.addEventListener('webglcontextlost', (ev) => {
    const now = Date.now();
    losses.push(now);
    while (losses.length && now - losses[0] > 5 * 60_000) losses.shift();
    lost = true;
    givenUp = losses.length >= 3;
    if (!givenUp) ev.preventDefault(); // lets the browser restore the context
    text.textContent = givenUp
      ? `The graphics card keeps resetting, so the 3D view has stopped to protect your computer. ${RESTART}`
      : 'The graphics card reset, so the 3D view paused. It will come back by itself in a moment, at a lighter setting.';
    notice.hidden = false;
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    if (givenUp) return;
    lost = false;
    notice.hidden = true;
    lower();
    onRestore();
  });
  // Frame timing: if the average frame over ~2 seconds is slower than ~30 fps, drop to pixel ratio 1.
  let last = 0;
  let slow = 0;
  let frames = 0;
  /** Stop and say why, instead of leaving a blank canvas. */
  const fail = (message) => {
    lost = true;
    givenUp = true;
    text.textContent = message;
    notice.hidden = false;
  };
  if (renderer.getContext().isContextLost()) fail(`The browser has 3D graphics switched off for this page. ${RESTART}`);
  return {
    renderer,
    fail: (err) => {
      console.error(err);
      fail(`The 3D view hit an error and stopped: ${err?.message ?? err}. Reload the page to try again. ${RESTART}`);
    },
    isLost: () => lost,
    tick(now) {
      if (last) {
        const dt = now - last;
        if (dt < 500) {
          frames++;
          if (dt > 34) slow++;
          if (frames >= 120) {
            if (slow > frames * 0.6) lower();
            frames = slow = 0;
          }
        }
      }
      last = now;
    },
  };
}
