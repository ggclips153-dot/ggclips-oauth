// Dashboard logins (username + password -> a profile). Passwords are stored only as scrypt hashes.
//   npm run user -- add --username marc --profile marc        (prompts for the password, hidden)
//   npm run user -- add --username ana --profile mayor-ai-receptionist-city
//   npm run user -- list
//   npm run user -- remove --username ana
// For automation, WORLD_PASSWORD=... skips the prompt.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { MIN_PASSWORD_LENGTH, Users, hashPassword, type UserRecord } from '../src/auth/users.ts';

const root = resolve(import.meta.dirname, '..');
const path = resolve(root, process.env.WORLD_USERS ?? 'config/users.json');
const profilesPath = resolve(root, process.env.WORLD_PROFILES ?? 'config/profiles.json');
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { username: { type: 'string' }, profile: { type: 'string' } },
});
const list: UserRecord[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
const save = () => {
  new Users(list); // validates
  writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
};

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
      done(answer);
    });
  });
}

switch (positionals[0]) {
  case 'list':
    for (const u of list) console.log(`${u.username.padEnd(24)} -> ${u.profileId}`);
    break;
  case 'remove': {
    const i = list.findIndex((u) => u.username.toLowerCase() === values.username?.toLowerCase());
    if (i < 0) throw new Error(`no user ${values.username}`);
    list.splice(i, 1);
    save();
    console.log(`Removed ${values.username}. Their open sessions end at the next server restart.`);
    break;
  }
  case 'add': {
    const { username, profile } = values;
    if (!username || !profile) throw new Error('--username and --profile are required');
    if (list.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new Error(`user ${username} already exists`);
    const profiles: { id: string }[] = existsSync(profilesPath) ? JSON.parse(readFileSync(profilesPath, 'utf8')) : [];
    if (!profiles.some((p) => p.id === profile)) throw new Error(`no profile "${profile}" in ${profilesPath}; create it with npm run profile -- add`);
    const password = process.env.WORLD_PASSWORD ?? (await askHidden(`Password for ${username} (min ${MIN_PASSWORD_LENGTH} characters): `));
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    list.push({ username, profileId: profile, ...hashPassword(password) });
    save();
    console.log(`Added ${username} -> ${profile}.`);
    break;
  }
  default:
    console.log('usage: user add --username <name> --profile <profileId> | user list | user remove --username <name>');
}
