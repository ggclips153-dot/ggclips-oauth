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
  const capsule = (r, len, drop) => keep(new THREE.CapsuleGeometry(r, len, 3, 8).translate(0, drop ? -(len / 2 + r) : 0, 0));
  P = {
    head: keep(new THREE.SphereGeometry(0.13, 14, 10)),
    hair: keep(new THREE.SphereGeometry(0.138, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)),
    neck: keep(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8)),
    torso: capsule(0.16, 0.3, false),
    hips: keep(new THREE.BoxGeometry(0.31, 0.14, 0.19)),
    arm: capsule(0.055, 0.42, true),
    leg: capsule(0.075, 0.62, true),
    hand: keep(new THREE.SphereGeometry(0.052, 8, 6)),
    shoe: keep(new THREE.BoxGeometry(0.12, 0.07, 0.24)),
    visor: keep(new THREE.BoxGeometry(0.2, 0.045, 0.07)),
    stripe: keep(new THREE.BoxGeometry(0.035, 0.34, 0.02)),
    cap: keep(new THREE.BoxGeometry(0.34, 0.03, 0.34)),
    capBase: keep(new THREE.CylinderGeometry(0.12, 0.13, 0.08, 10)),
    hit: keep(new THREE.BoxGeometry(0.55, 1.85, 0.45).translate(0, 0.92, 0)),
  };
  return P;
}

/**
 * A person, about 1.8 units tall, facing +z. The jacket carries the agent's tier colour; the rest
 * (skin, hair, neon visor) varies by seed. Returns { group, hit, rig } — animate with `animatePerson`.
 */
export function person({ jacket, seed = 'p', accent = NEON.cyan, cap = null }) {
  const G = personGeos();
  const rand = rng(seed);
  const skin = solid(SKIN[Math.floor(rand() * SKIN.length)], { rough: 0.8, metal: 0 });
  const hairMat = solid(HAIR[Math.floor(rand() * HAIR.length)], { rough: 0.6, metal: 0.1 });
  const coat = solid(jacket, { rough: 0.55, metal: 0.25, glow: 0.28 });
  const pants = solid('#1a1b28', { rough: 0.8, metal: 0.1 });
  const shoes = solid('#0a0a10', { rough: 0.5, metal: 0.3 });
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const limb = (geo, mat, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(new THREE.Mesh(geo, mat));
    body.add(pivot);
    return pivot;
  };
  const legL = limb(G.leg, pants, 0.085, 0.82);
  const legR = limb(G.leg, pants, -0.085, 0.82);
  for (const leg of [legL, legR]) {
    const shoe = new THREE.Mesh(G.shoe, shoes);
    shoe.position.set(0, -0.78, 0.04);
    leg.add(shoe);
  }
  const hips = new THREE.Mesh(G.hips, pants);
  hips.position.y = 0.88;
  const torso = new THREE.Mesh(G.torso, coat);
  torso.position.y = 1.22;
  torso.scale.set(1.12, 1, 0.72);
  const stripe = new THREE.Mesh(G.stripe, neon(accent));
  stripe.position.set(0.06, 1.24, 0.12);
  const neck = new THREE.Mesh(G.neck, skin);
  neck.position.y = 1.56;
  const head = new THREE.Mesh(G.head, skin);
  head.position.y = 1.69;
  const hair = new THREE.Mesh(G.hair, hairMat);
  hair.position.y = 1.705;
  hair.rotation.x = -0.25;
  body.add(hips, torso, stripe, neck, head, hair);
  if (rand() < 0.55) {
    const visor = new THREE.Mesh(G.visor, neon(rand() < 0.5 ? NEON.cyan : NEON.magenta));
    visor.position.set(0, 1.71, 0.1);
    body.add(visor);
  }
  if (cap) {
    const base = new THREE.Mesh(G.capBase, solid('#111018'));
    base.position.y = 1.8;
    const board = new THREE.Mesh(G.cap, solid(cap, { glow: 0.4 }));
    board.position.y = 1.85;
    board.rotation.y = Math.PI / 4;
    body.add(base, board);
  }
  const armL = limb(G.arm, coat, 0.215, 1.44);
  const armR = limb(G.arm, coat, -0.215, 1.44);
  for (const arm of [armL, armR]) {
    const hand = new THREE.Mesh(G.hand, skin);
    hand.position.y = -0.56;
    arm.add(hand);
  }
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

// ---------- renderer health ----------
/**
 * A renderer tuned for laptops: pixel ratio capped at 1.5 (retina at 2x draws 78% more pixels for little
 * visible gain here). If the graphics driver resets (WebGL context lost), the view pauses with a notice
 * instead of freezing, and resumes on its own when the browser restores the context.
 * Returns { renderer, isLost() }.
 */
export function makeRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  let lost = false;
  const notice = document.createElement('div');
  notice.className = 'w3d-lost';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const text = document.createElement('p');
  text.textContent = 'The graphics card reset, so the 3D view paused. It should come back by itself in a moment.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'small-btn primary';
  retry.textContent = 'Reload the page';
  retry.addEventListener('click', () => location.reload());
  notice.append(text, retry);
  container.append(notice);
  renderer.domElement.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault(); // lets the browser restore the context
    lost = true;
    notice.hidden = false;
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    lost = false;
    notice.hidden = true;
  });
  return { renderer, isLost: () => lost };
}
