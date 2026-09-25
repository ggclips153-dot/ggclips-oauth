// Run the red-team corpus against the shared-surface injection scanner.
//   npm run redteam
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanForInjection } from '../src/security/surfaceGuard.ts';

const corpus = JSON.parse(readFileSync(resolve(import.meta.dirname, '../security/redteam.json'), 'utf8')) as { attack: string[]; benign: string[] };
const missed = corpus.attack.filter((t) => scanForInjection(t).length === 0);
const falseAlarms = corpus.benign.filter((t) => scanForInjection(t).length > 0);
console.log(`Attacks caught: ${corpus.attack.length - missed.length} / ${corpus.attack.length}`);
console.log(`Benign notes passed: ${corpus.benign.length - falseAlarms.length} / ${corpus.benign.length}`);
for (const t of missed) console.log(`  MISSED attack: ${t}`);
for (const t of falseAlarms) console.log(`  FALSE ALARM:  ${t}  -> ${scanForInjection(t).map((h) => h.id).join(', ')}`);
process.exit(missed.length || falseAlarms.length ? 1 : 0);
