// Verify the event ledger's hash chain end to end.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ledger } from '../src/ledger/ledger.ts';

const path = resolve(import.meta.dirname, '..', process.env.WORLD_DB ?? 'data/world.db');
if (!existsSync(path)) {
  console.error(`No ledger at ${path}. Nothing to verify (check WORLD_DB, or run npm run seed).`);
  process.exit(1);
}
const ledger = new Ledger({ path });
const result = ledger.verify();
console.log(result.ok ? `OK: ${result.count} events, chain intact` : `BROKEN at seq ${result.brokenAt}: ${result.reason}`);
process.exit(result.ok ? 0 : 1);
