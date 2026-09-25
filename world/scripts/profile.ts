// Manage API profiles. Tokens are printed ONCE and stored only as sha256.
//   npm run profile -- add --id marc --role owner
//   npm run profile -- add --id dm --role dm
//   npm run profile -- add --id bob --role architect
//   npm run profile -- add --id mayor-ai-receptionist-city --role mayor --city ai-receptionist-city
//   npm run profile -- add --id hermes-gateway --role gateway   (shared-surface guard only)
//   npm run profile -- list
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkProfile, hashToken, newToken, type ProfileRecord } from '../src/auth/profiles.ts';
import type { Role } from '../src/domain/model.ts';

const path = resolve(import.meta.dirname, '..', process.env.WORLD_PROFILES ?? 'config/profiles.json');
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { id: { type: 'string' }, role: { type: 'string' }, city: { type: 'string' }, label: { type: 'string' } },
});
const list: ProfileRecord[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];

switch (positionals[0]) {
  case 'list':
    for (const p of list) console.log(`${p.id.padEnd(32)} ${p.role.padEnd(10)} writeScope=${JSON.stringify(p.writeScope)}`);
    break;
  case 'add': {
    const role = values.role as Role;
    if (!values.id || !role) throw new Error('--id and --role are required');
    if (list.some((p) => p.id === values.id)) throw new Error(`profile ${values.id} already exists`);
    const writeScope = role === 'mayor' ? [values.city ?? ''] : role === 'architect' || role === 'gateway' ? [] : ['*'];
    const token = newToken();
    const record = checkProfile({ id: values.id, role, writeScope, label: values.label, tokenSha256: hashToken(token) });
    list.push(record);
    writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
    console.log(`Added ${record.id} (${role}). Token (shown once, store it in the bot's secrets):\n${token}`);
    break;
  }
  default:
    console.log('usage: profile add --id <id> --role owner|dm|mayor|architect [--city <cityId>] | profile list');
}
