import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Profiles, hashToken, newToken } from '../auth/profiles.ts';
import { Secrets } from '../auth/secrets.ts';
import { Users, hashPassword } from '../auth/users.ts';
import { Ledger } from '../ledger/ledger.ts';
import { createApp } from './app.ts';
import { buildId } from './build.ts';
import { MediaStore } from '../social/media.ts';
import { attachPublisher } from '../social/publisher.ts';
import { attachDemoAutopilot } from './demoAutopilot.ts';
import { attachMessengerWebhook } from './messengerWebhook.ts';
import { type StarnetInfo } from './app.ts';
import { attachStarnetBridge } from '../starnet/bridge.ts';
import { Stations } from '../starnet/stations.ts';
import { SurfaceFeed } from '../surface/feed.ts';

const root = resolve(import.meta.dirname, '../..');
// `--demo`: the sample world in data/demo.db, with the demo Messenger/Mayor stand-in, for trying things locally.
const demo = process.argv.includes('--demo');
const dbPath = resolve(root, demo ? 'data/demo.db' : (process.env.WORLD_DB ?? 'data/world.db'));
const profilesPath = resolve(root, process.env.WORLD_PROFILES ?? 'config/profiles.json');
const port = Number(process.env.WORLD_PORT ?? 8787);
// Bind to localhost by default; expose through a reverse proxy with TLS on the VPS.
const host = process.env.WORLD_HOST ?? '127.0.0.1';

mkdirSync(dirname(dbPath), { recursive: true });
const ledger = (() => {
  try {
    return new Ledger({ path: dbPath });
  } catch (err) {
    console.error(`Refusing to start: ${(err as Error).message}`);
    process.exit(1);
  }
})();
const integrity = ledger.verify();
if (!integrity.ok) {
  console.error(`LEDGER INTEGRITY FAILURE at seq ${integrity.brokenAt}: ${integrity.reason}. Refusing to start.`);
  process.exit(1);
}

// The demo world has its own sign-in, kept in memory (marc / demo-password-123). It never reads or writes the real
// world's logins or secrets, so neither the demo's published password nor a real bot token crosses over.
const DEMO_PASSWORD = 'demo-password-123';
const profiles = demo
  ? new Profiles([{ id: 'marc', role: 'owner', label: 'Marc', writeScope: ['*'], tokenSha256: hashToken(newToken()) }])
  : Profiles.load(profilesPath);
if (profiles.size === 0) console.warn(`No profiles in ${profilesPath}. Create one with: npm run profile -- add ...`);

// A22: the District Messenger is now the World Messenger, and its settings were renamed with it.
for (const old of ['DM_WEBHOOK_URL', 'DM_WEBHOOK_SECRET']) {
  if (process.env[old]) {
    console.error(`Refusing to start: ${old} is now called ${old.replace('DM_', 'MESSENGER_')} (A22: the World Messenger).`);
    process.exit(1);
  }
}
// Demo data never reaches the real World Messenger.
if (!demo && process.env.MESSENGER_WEBHOOK_URL) {
  if (!process.env.MESSENGER_WEBHOOK_SECRET) throw new Error('MESSENGER_WEBHOOK_SECRET is required with MESSENGER_WEBHOOK_URL');
  attachMessengerWebhook(ledger, { url: process.env.MESSENGER_WEBHOOK_URL, secret: process.env.MESSENGER_WEBHOOK_SECRET });
}

const users = demo
  ? new Users([{ username: 'marc', profileId: 'marc', ...hashPassword(DEMO_PASSWORD) }])
  : Users.load(resolve(root, process.env.WORLD_USERS ?? 'config/users.json'));
if (users.size === 0) console.warn('No dashboard logins yet. Create one with: npm run user -- add --username marc --profile marc');

// StarNet (A20): one station per city, run from StarNet's source. Set STARNET_DIR to that folder.
const starnetEvents = new EventEmitter();
let starnet: StarnetInfo = { events: starnetEvents, view: () => ({ enabled: false, reason: 'STARNET_DIR is not set' }) };
let starnetHandles = (_city: string) => false;
const starnetDir = process.env.STARNET_DIR?.replace(/^~(?=$|[\\/])/, homedir());
if (starnetDir) {
  const problem = Stations.check(resolve(starnetDir));
  if (problem) {
    console.warn(`StarNet: ${problem}. Stations are off.`);
    starnet = { events: starnetEvents, view: () => ({ enabled: false, reason: problem }) };
  } else {
    const changed = () => starnetEvents.emit('change');
    const scope = demo ? 'demo' : 'world';
    const stations = new Stations(scope, {
      starnetDir: resolve(starnetDir),
      workspacesDir: resolve(root, 'data/starnet', scope),
      configPath: resolve(root, process.env.WORLD_STARNET_CONFIG ?? 'config/starnet.json'),
      basePort: Number(process.env.STARNET_BASE_PORT ?? 8801),
      onChange: changed,
    });
    const bridge = attachStarnetBridge(ledger, stations, { onChange: changed });
    starnetHandles = (city) => bridge.handles(city);
    stations.startAll([...ledger.state.cities.keys()]);
    // A new city gets its station as soon as it exists.
    ledger.events.on('event', (e) => {
      if (e.type === 'city.created' && e.subject) stations.start(e.subject);
    });
    const inScope = (scopeId: string, cityId: string) => scopeId === '*' || scopeId === cityId;
    starnet = {
      events: starnetEvents,
      view: (scopeId) => ({
        enabled: true,
        stations: Object.fromEntries(Object.entries(stations.statuses()).filter(([c]) => inScope(scopeId, c))),
        errors: Object.fromEntries(Object.entries(bridge.errors()).filter(([id]) => inScope(scopeId, ledger.state.agents.get(id)?.cityId ?? ''))),
        working: bridge.working().filter((id) => inScope(scopeId, ledger.state.agents.get(id)?.cityId ?? '')),
      }),
    };
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      process.once(sig, () => {
        stations.stop();
        setTimeout(() => process.exit(0), 300);
      });
    }
    console.log(`StarNet: starting a station per city from ${starnetDir} (ports from ${process.env.STARNET_BASE_PORT ?? 8801})`);
  }
}

// The shared memory surface (A21), read-only, from vps/surface_reader.py over Tailscale.
const surfaceEvents = new EventEmitter();
let sharedSurface: StarnetInfo | undefined;
if (process.env.SURFACE_URL) {
  if (!process.env.SURFACE_TOKEN) throw new Error('SURFACE_TOKEN is required with SURFACE_URL');
  const feed = new SurfaceFeed({
    url: process.env.SURFACE_URL,
    token: process.env.SURFACE_TOKEN,
    cityMapPath: resolve(root, process.env.WORLD_SURFACE_CITIES ?? 'config/surface-cities.json'),
    onChange: () => surfaceEvents.emit('change'),
  });
  feed.start();
  sharedSurface = { events: surfaceEvents, view: (scope) => feed.view(scope, (id) => ledger.state.cities.has(id)) };
  console.log(`Shared surface: reading ${process.env.SURFACE_URL} (read-only)`);
}

if (demo) attachDemoAutopilot(ledger, dbPath, undefined, { starnetHandles: (city) => starnetHandles(city) });
// Photos and videos for posts, and the publisher that posts approved, scheduled posts when their time comes
// (through a platform connector once one is connected; until then they wait, ready to post by hand).
const media = new MediaStore(resolve(root, 'data/media'));
attachPublisher(ledger, [], { mediaPath: (ref) => media.path(ref.replace(/^media\//, '')) });

// Pick up events written by other processes (e.g. a script run while the server is running).
setInterval(() => {
  try {
    ledger.sync();
  } catch (err) {
    console.error('ledger sync failed:', err);
  }
}, 5000).unref();

createApp(ledger, profiles, {
  users,
  secrets: new Secrets(demo ? null : resolve(root, process.env.WORLD_SECRETS ?? 'config/secrets.json')),
  cookieSecure: !demo && process.env.WORLD_COOKIE_SECURE !== '0',
  trustProxy: process.env.WORLD_TRUST_PROXY === '1',
  demo,
  media,
  starnet,
  sharedSurface,
}).listen(port, host, () => {
  console.log(`World ledger: ${integrity.count} events verified. Listening on http://${host}:${port}`);
  console.log(`Build ${buildId(root)} · serving ${root}`);
  if (demo) console.log(`Demo sign-in: marc / ${DEMO_PASSWORD}`);
});
