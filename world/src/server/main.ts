import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Profiles } from '../auth/profiles.ts';
import { Ledger } from '../ledger/ledger.ts';
import { createApp } from './app.ts';
import { attachDmWebhook } from './dmWebhook.ts';

const root = resolve(import.meta.dirname, '../..');
const dbPath = resolve(root, process.env.WORLD_DB ?? 'data/world.db');
const profilesPath = resolve(root, process.env.WORLD_PROFILES ?? 'config/profiles.json');
const port = Number(process.env.WORLD_PORT ?? 8787);
// Bind to localhost by default; expose through a reverse proxy with TLS on the VPS.
const host = process.env.WORLD_HOST ?? '127.0.0.1';

mkdirSync(dirname(dbPath), { recursive: true });
const ledger = new Ledger({ path: dbPath });
const integrity = ledger.verify();
if (!integrity.ok) {
  console.error(`LEDGER INTEGRITY FAILURE at seq ${integrity.brokenAt}: ${integrity.reason}. Refusing to start.`);
  process.exit(1);
}

const profiles = Profiles.load(profilesPath);
if (profiles.size === 0) console.warn(`No profiles in ${profilesPath}. Create one with: npm run profile -- add ...`);

if (process.env.DM_WEBHOOK_URL) {
  if (!process.env.DM_WEBHOOK_SECRET) throw new Error('DM_WEBHOOK_SECRET is required with DM_WEBHOOK_URL');
  attachDmWebhook(ledger, { url: process.env.DM_WEBHOOK_URL, secret: process.env.DM_WEBHOOK_SECRET });
}

createApp(ledger, profiles).listen(port, host, () => {
  console.log(`World ledger: ${integrity.count} events verified. Listening on http://${host}:${port}`);
});
