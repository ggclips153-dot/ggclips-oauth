// Verify the event ledger's hash chain end to end.
import { resolve } from 'node:path';
import { Ledger } from '../src/ledger/ledger.ts';

const ledger = new Ledger({ path: resolve(import.meta.dirname, '..', process.env.WORLD_DB ?? 'data/world.db') });
const result = ledger.verify();
console.log(result.ok ? `OK: ${result.count} events, chain intact` : `BROKEN at seq ${result.brokenAt}: ${result.reason}`);
process.exit(result.ok ? 0 : 1);
