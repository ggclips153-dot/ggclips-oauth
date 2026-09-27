// CyberStation's link to Hermes (A31): the address of Hermes's API server and each profile's key, kept on this PC
// in config/hermes.json (private: never in the ledger, never in chat). Run it in your own window.
//   npm run hermes -- url http://<VPS Tailscale IP>:8642            (one server for every profile: /p/<profile>/v1)
//   npm run hermes -- url http://<VPS Tailscale IP>:8642 --single   (a server that runs one profile: /v1)
//   npm run hermes -- key <profile>                             (asks for its API_SERVER_KEY, hidden)
//   npm run hermes -- remove <profile>
//   npm run hermes -- list                                      (the profiles with a key; never the keys)
//   npm run hermes -- check                                     (is Hermes up, and does it accept each key?)
// Restart the world server afterwards: it reads these settings when it starts.
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { HermesLink, loadHermesSettings, saveHermesSettings } from '../src/cyberstation/hermes.ts';

const root = resolve(import.meta.dirname, '..');
const path = resolve(root, process.env.WORLD_HERMES ?? 'config/hermes.json');
const { positionals, values } = parseArgs({ allowPositionals: true, options: { single: { type: 'boolean' } } });
const settings = loadHermesSettings(path);
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function askHidden(question: string): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let asked = false;
    out._writeToOutput = (s: string) => {
      if (!asked) {
        process.stdout.write(s);
        asked = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      done(answer.trim());
    });
  });
}

const profileArg = () => {
  const name = positionals[1];
  if (!name || !PROFILE_RE.test(name)) throw new Error('give the Hermes profile name, e.g.: npm.cmd run hermes -- key aden');
  return name;
};

switch (positionals[0]) {
  case 'url': {
    const url = String(positionals[1] ?? '').replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+$/.test(url)) throw new Error('give the API server address, e.g.: npm.cmd run hermes -- url http://<VPS Tailscale IP>:8642');
    saveHermesSettings(path, { ...settings, url, multiplex: !values.single });
    console.log(`Hermes's API server: ${url} (${values.single ? 'one profile: /v1' : 'every profile: /p/<profile>/v1'}). Restart the world server to use it.`);
    break;
  }
  case 'key': {
    const profile = profileArg();
    const key = await askHidden(`API_SERVER_KEY for Hermes profile ${profile} (hidden): `);
    if (key.length < 8) throw new Error('that key is too short; nothing was saved');
    const keys = Object.fromEntries(Object.entries(settings.keys).filter(([name]) => name.toLowerCase() !== profile.toLowerCase()));
    saveHermesSettings(path, { ...settings, keys: { ...keys, [profile]: key } });
    console.log(`Saved the key for ${profile}. Restart the world server to use it.`);
    break;
  }
  case 'remove': {
    const profile = profileArg();
    const keys = Object.fromEntries(Object.entries(settings.keys).filter(([name]) => name.toLowerCase() !== profile.toLowerCase()));
    if (Object.keys(keys).length === Object.keys(settings.keys).length) throw new Error(`no key for ${profile}`);
    saveHermesSettings(path, { ...settings, keys });
    console.log(`Removed the key for ${profile}. Restart the world server.`);
    break;
  }
  case 'list':
    console.log(settings.url ? `Hermes: ${settings.url} (${settings.multiplex ? 'every profile' : 'one profile'})` : "Hermes's address isn't set yet.");
    for (const name of Object.keys(settings.keys).sort()) console.log(`  ${name}: key saved`);
    if (!Object.keys(settings.keys).length) console.log('  No profile keys yet.');
    break;
  case 'check': {
    const link = new HermesLink(settings);
    const health = await link.health();
    console.log(`Hermes at ${settings.url || '(no address set)'}: ${health.ok ? 'up' : `not reachable (${health.detail})`}`);
    for (const name of link.profiles()) {
      const r = await link.checkKey(name);
      console.log(`  ${name}: ${r.ok ? 'key accepted' : `not accepted (${r.detail})`}`);
    }
    break;
  }
  default:
    console.log('Usage: npm run hermes -- url <address> [--single] | key <profile> | remove <profile> | list | check');
}
