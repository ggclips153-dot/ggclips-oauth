// Seed the first cities through the real path: Marc intent -> DM routes -> DM writes city.created.
// Idempotent by name: a city that already exists is skipped.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { WORLD_TAG } from '../src/domain/model.ts';
import type { Profile } from '../src/ledger/guard.ts';
import { Ledger } from '../src/ledger/ledger.ts';

const root = resolve(import.meta.dirname, '..');
const seedPath = resolve(root, 'config/seed.json');
if (!existsSync(seedPath)) {
  console.error('Missing config/seed.json. Copy config/seed.example.json and fill in the Mayor names.');
  process.exit(1);
}
const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as { cities: { name: string; family: string; mayorName: string }[] };
const todo = seed.cities.filter((c) => /TODO/.test(c.mayorName));
if (todo.length) {
  console.error(`Mayor name still TODO for: ${todo.map((c) => c.name).join(', ')}`);
  process.exit(1);
}

const dbPath = resolve(root, process.env.WORLD_DB ?? 'data/world.db');
mkdirSync(dirname(dbPath), { recursive: true });
const ledger = new Ledger({ path: dbPath });
const marc: Profile = { id: 'marc', role: 'owner', writeScope: ['*'] };
const dm: Profile = { id: 'dm', role: 'dm', writeScope: ['*'] };
const existing = new Set([...ledger.state.cities.values()].map((c) => c.name.toLowerCase()));

for (const city of seed.cities) {
  if (existing.has(city.name.toLowerCase())) {
    console.log(`skip  ${city.name} (exists)`);
    continue;
  }
  const payload = { name: city.name, family: city.family, mayorName: city.mayorName };
  const intent = ledger.append(marc, { type: 'intent.create_city', city: WORLD_TAG, payload });
  ledger.append(dm, { type: 'dm.routed', city: WORLD_TAG, payload: { intentSeq: intent.seq, to: 'world' } });
  const created = ledger.append(dm, { type: 'city.created', city: WORLD_TAG, payload, authorizedBy: intent.seq });
  console.log(`city  ${city.name} -> city=${created.subject}`);
}
ledger.close();
