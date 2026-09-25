// World Constitution tools (Article XII).
//   npm run constitution -- hash                 fingerprint of the file on disk
//   npm run constitution -- pointer              the pointer line every SOUL carries (ratified version)
//   npm run constitution -- check <SOUL files>   verify each SOUL's pointer; flag copies and softening
// Reads the ratified version from the ledger (WORLD_DB, default data/world.db). Never writes it:
// ratifying is Marc's intent, routed by the DM.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkSoul, pointerLine, readConstitution } from '../src/domain/constitution.ts';
import { Ledger } from '../src/ledger/ledger.ts';

const root = resolve(import.meta.dirname, '..');
const [cmd, ...files] = process.argv.slice(2);

const file = readConstitution();
if (!file) {
  console.error('Missing docs/constitution/WORLD-CONSTITUTION.md');
  process.exit(1);
}

function ratified() {
  const dbPath = resolve(root, process.env.WORLD_DB ?? 'data/world.db');
  if (!existsSync(dbPath)) return null;
  const ledger = new Ledger({ path: dbPath });
  const current = ledger.state.constitution.current;
  ledger.close();
  return current;
}

switch (cmd) {
  case 'hash':
    console.log(file.sha256);
    break;
  case 'pointer': {
    const r = ratified();
    if (!r) {
      console.error('No Constitution version is ratified in the ledger yet. Run npm run seed (ratifies 1.0.0) or ratify from the dashboard.');
      process.exit(1);
    }
    if (r.sha256 !== file.sha256) console.error(`warning: the file on disk does not match ratified ${r.version}; it is not in force`);
    console.log(pointerLine(r.version, r.sha256));
    break;
  }
  case 'check': {
    if (!files.length) {
      console.error('usage: npm run constitution -- check <SOUL.md> [more SOULs]');
      process.exit(1);
    }
    const r = ratified();
    if (r && r.sha256 !== file.sha256) console.error(`warning: the file on disk does not match ratified ${r.version}`);
    let bad = 0;
    for (const f of files) {
      const res = checkSoul(readFileSync(resolve(f), 'utf8'), r, file.text);
      if (res.ok) console.log(`ok    ${f}`);
      else {
        bad++;
        console.log(`FAIL  ${f}`);
        for (const p of res.problems) console.log(`      - ${p}`);
      }
    }
    process.exit(bad ? 1 : 0);
  }
  default:
    console.error('usage: npm run constitution -- hash | pointer | check <SOUL files>');
    process.exit(1);
}
