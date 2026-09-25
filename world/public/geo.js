// World geography shared by the globe and the 3D city: continents per family, where each city sits,
// and which cities the superhighways join. Pure maths, no three.js.
export const DEG = Math.PI / 180;
export const FAMILY_ORDER = ['revenue', 'essentials', 'claude', 'gemini'];
/** Continents: centre (lat, lon) and angular radius. Revenue gets the room; Claude and Gemini hold one city each. */
export const CONTINENTS = {
  revenue: { lat: 8, lon: 12, rad: 58 },
  essentials: { lat: 34, lon: 128, rad: 30 },
  claude: { lat: -36, lon: -112, rad: 13 },
  gemini: { lat: 36, lon: -96, rad: 13 },
};

/** The point `dist` degrees from (lat, lon) along `bearing` degrees. */
export function destination(lat, lon, bearing, dist) {
  const [p1, l1, b, d] = [lat * DEG, lon * DEG, bearing * DEG, dist * DEG];
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / DEG, lon: ((l2 / DEG + 540) % 360) - 180 };
}

/** Initial bearing (degrees clockwise from north) from a to b. */
export function bearing(a, b) {
  const [p1, p2, dl] = [a.lat * DEG, b.lat * DEG, (b.lon - a.lon) * DEG];
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Great-circle distance in degrees. */
export function arcDegrees(a, b) {
  const [p1, p2, dl] = [a.lat * DEG, b.lat * DEG, (b.lon - a.lon) * DEG];
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

/** City spots inside a family's continent: a sunflower spiral, so any number of cities spreads evenly. */
export function citySpots(family, n) {
  const c = CONTINENTS[family];
  if (n === 1) return [{ lat: c.lat, lon: c.lon }];
  return Array.from({ length: n }, (_, k) => destination(c.lat, c.lon, k * 137.508, c.rad * 0.72 * Math.sqrt((k + 0.5) / n)));
}

/** Every city's (lat, lon), in the order the map lists them. */
export function cityPlaces(cities) {
  const out = new Map();
  for (const fam of FAMILY_ORDER) {
    const list = cities.filter((c) => c.family === fam);
    citySpots(fam, list.length).forEach((spot, i) => out.set(list[i].id, spot));
  }
  return out;
}

/**
 * The superhighway network: a minimum spanning tree (every city reachable) plus each city's nearest
 * neighbour, so busy regions get a second route. Returns [idA, idB] pairs.
 */
export function highwayLinks(places) {
  const ids = [...places.keys()];
  if (ids.length < 2) return [];
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const links = new Map();
  const inTree = new Set([ids[0]]);
  while (inTree.size < ids.length) {
    let best = null;
    for (const a of inTree) {
      for (const b of ids) {
        if (inTree.has(b)) continue;
        const d = arcDegrees(places.get(a), places.get(b));
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    inTree.add(best.b);
    links.set(key(best.a, best.b), [best.a, best.b]);
  }
  for (const a of ids) {
    let near = null;
    for (const b of ids) {
      if (a === b) continue;
      const d = arcDegrees(places.get(a), places.get(b));
      if (!near || d < near.d) near = { b, d };
    }
    links.set(key(a, near.b), [a, near.b]);
  }
  return [...links.values()];
}

/** Wobbly coastline noise, from latitude/longitude in radians. */
export const coastNoise = (la, lo) => 0.5 * Math.sin(3 * lo + 2.1 * Math.sin(2 * la)) + 0.3 * Math.sin(7 * la + 5 * lo) + 0.2 * Math.sin(13 * lo - 11 * la);

/** The family whose continent covers (lat, lon) in degrees, or null for ocean. */
export function landAt(lat, lon) {
  const la = lat * DEG;
  const lo = lon * DEG;
  const n = coastNoise(la, lo);
  for (const f of FAMILY_ORDER) {
    const c = CONTINENTS[f];
    if (arcDegrees({ lat, lon }, c) * DEG < c.rad * DEG * (1 + 0.16 * n)) return f;
  }
  return null;
}

/** Small deterministic random numbers, so the world always looks the same. */
export function rng(seedText) {
  let s = 0;
  for (const ch of String(seedText)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
