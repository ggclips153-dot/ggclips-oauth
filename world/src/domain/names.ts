// Display-name generator. A name is a LABEL only (the ID is the identity), but suggestions never
// reuse a retired name, a living agent's name, or a reserved name (Marc, Bob, the Mayors).
import { randomInt } from 'node:crypto';
import type { WorldState } from './state.ts';

export const FIRST_NAMES = [
  'Aden', 'Aiko', 'Alba', 'Alden', 'Amara', 'Anders', 'Anya', 'Arlo', 'Asha', 'Astrid',
  'Atlas', 'Aurel', 'Bastian', 'Bea', 'Bexley', 'Birdie', 'Blaise', 'Bodhi', 'Briar', 'Bruno',
  'Cade', 'Calla', 'Callum', 'Cato', 'Celeste', 'Cleo', 'Cosmo', 'Cyrus', 'Dahlia', 'Dario',
  'Dax', 'Delphine', 'Desmond', 'Dora', 'Dune', 'Eamon', 'Echo', 'Edie', 'Elio', 'Elska',
  'Emeric', 'Enzo', 'Esme', 'Ezra', 'Fable', 'Faye', 'Felix', 'Fenna', 'Finch', 'Flint',
  'Freya', 'Gideon', 'Gemma', 'Hale', 'Hana', 'Harlow', 'Hollis', 'Idris', 'Ilse', 'Imani',
  'Indigo', 'Ines', 'Iris', 'Ivo', 'Jett', 'Juno', 'Jasper', 'Kai', 'Kaia', 'Keanu',
  'Kenji', 'Kit', 'Koa', 'Lark', 'Leif', 'Lena', 'Linus', 'Lior', 'Lumi', 'Lyra',
  'Mabel', 'Mako', 'Mara', 'Marlow', 'Milo', 'Mira', 'Nadia', 'Nico', 'Niamh', 'Nova',
  'Oakley', 'Odette', 'Omar', 'Onyx', 'Orla', 'Orson', 'Otto', 'Pax', 'Pema', 'Petra',
  'Pip', 'Quill', 'Quinn', 'Rafe', 'Ravi', 'Remy', 'Rhea', 'Rio', 'Rook', 'Rowan',
  'Rumi', 'Sable', 'Sage', 'Saoirse', 'Sasha', 'Selah', 'Silas', 'Soren', 'Sunny', 'Tamsin',
  'Tate', 'Teo', 'Thea', 'Tova', 'Uma', 'Ursa', 'Vale', 'Vesper', 'Vida', 'Wren',
  'Xavi', 'Yara', 'Yusuf', 'Zadie', 'Zane', 'Zara', 'Zephyr', 'Zia', 'Ziggy', 'Zora',
];

export const SURNAMES = [
  'Ashby', 'Beacon', 'Birch', 'Blackwood', 'Bramble', 'Brightwater', 'Calder', 'Carrow', 'Cinder', 'Cobalt',
  'Cove', 'Crane', 'Dawson', 'Delacroix', 'Drake', 'Ember', 'Everly', 'Fairweather', 'Falk', 'Fernhill',
  'Flint', 'Frost', 'Garnet', 'Glass', 'Gray', 'Hale', 'Harbor', 'Hawthorne', 'Heron', 'Holloway',
  'Ives', 'Juniper', 'Keel', 'Kestrel', 'Lark', 'Linden', 'Lowell', 'Marsh', 'Meridian', 'Moss',
  'North', 'Oakes', 'Onyx', 'Orchard', 'Pike', 'Quarry', 'Rain', 'Reed', 'Ridge', 'Rook',
  'Sable', 'Sands', 'Sparrow', 'Stone', 'Storm', 'Summit', 'Swift', 'Thorne', 'Tide', 'Vance',
  'Vesper', 'Wilder', 'Winter', 'Wolfe', 'Wren', 'Yarrow',
];

/** Names that belong to real people in the world and are never handed to an agent. */
export const RESERVED_NAMES = ['Marc', 'Bob'];

export interface NameOptions {
  first?: readonly string[];
  last?: readonly string[];
  /** Random integer in [0, max). Injectable for tests. */
  rand?: (max: number) => number;
}

const key = (name: string) => name.trim().toLowerCase();

/** Every name an agent must not be given right now. */
export function takenNames(state: WorldState): Set<string> {
  const taken = new Set<string>(state.retiredNames);
  for (const a of state.agents.values()) taken.add(key(a.name));
  for (const p of state.professors.values()) taken.add(key(p.name));
  for (const c of state.cities.values()) taken.add(key(c.mayorName));
  for (const n of RESERVED_NAMES) taken.add(key(n));
  return taken;
}

/**
 * Suggest `count` distinct, available names. Single first names while any are free,
 * then "First Surname" pairs (thousands of combinations).
 */
export function suggestNames(state: WorldState, count = 1, opts: NameOptions = {}): string[] {
  const first = opts.first ?? FIRST_NAMES;
  const last = opts.last ?? SURNAMES;
  const rand = opts.rand ?? randomInt;
  const taken = takenNames(state);
  const out: string[] = [];

  const pick = (pool: string[]) => {
    while (pool.length && out.length < count) {
      const [name] = pool.splice(rand(pool.length), 1);
      if (!taken.has(key(name!))) {
        out.push(name!);
        taken.add(key(name!));
      }
    }
  };

  pick([...first]);
  if (out.length < count) pick(first.flatMap((f) => last.map((l) => `${f} ${l}`)));
  if (out.length < count) throw new Error('name pool exhausted; extend FIRST_NAMES / SURNAMES');
  return out;
}
