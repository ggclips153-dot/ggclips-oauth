import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Profiles, hashToken } from '../src/auth/profiles.ts';
import { LoginThrottle, Sessions } from '../src/auth/sessions.ts';
import { Users, hashPassword } from '../src/auth/users.ts';
import { createApp } from '../src/server/app.ts';
import { TestWorld } from './helpers.ts';

describe('dashboard sign-in', () => {
  const w = new TestWorld();
  const a = w.city('A City');
  w.city('B City');
  const profiles = new Profiles([
    { id: 'marc', role: 'owner', writeScope: ['*'], tokenSha256: hashToken('t-marc') },
    { id: 'mayor-a', role: 'mayor', writeScope: [a], tokenSha256: hashToken('t-mayor') },
  ]);
  const users = new Users([
    { username: 'marc', profileId: 'marc', ...hashPassword('correct horse battery') },
    { username: 'ana', profileId: 'mayor-a', ...hashPassword('ana long password') },
  ]);
  let clock = 0;
  const server = createApp(w.ledger, profiles, { users, sessions: new Sessions(() => clock), throttle: new LoginThrottle(() => clock) });
  let base = '';

  before(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const login = (username: string, password: string) =>
    fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!;
  const get = (path: string, cookie?: string) => fetch(base + path, { headers: cookie ? { cookie } : {} });

  it('signs in with a password and sets a hardened session cookie', async () => {
    const res = await login('marc', 'correct horse battery');
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie')!;
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(setCookie.includes(flag), flag);
    const me = await (await get('/api/me', cookieOf(res))).json();
    assert.equal(me.id, 'marc');
    assert.equal((await (await get('/api/session', cookieOf(res))).json()).profile.id, 'marc');
    assert.deepEqual(await (await get('/api/session')).json(), { profile: null });
  });

  it('rejects a wrong password, and locks a client out after 5 failures', async () => {
    clock = 1_000_000;
    for (let i = 0; i < 5; i++) assert.equal((await login('marc', 'wrong')).status, 401);
    assert.equal((await login('marc', 'correct horse battery')).status, 429, 'locked even with the right password');
    clock += LoginThrottle.WINDOW_MS + 1;
    assert.equal((await login('marc', 'correct horse battery')).status, 200);
  });

  it('a Mayor\'s login sees only its own city', async () => {
    const cookie = cookieOf(await login('ana', 'ana long password'));
    const state = await (await get('/api/state', cookie)).json();
    assert.deepEqual(state.cities.map((c: { id: string }) => c.id), [a]);
  });

  it('browser writes need the x-world-request header (CSRF)', async () => {
    const cookie = cookieOf(await login('marc', 'correct horse battery'));
    const body = JSON.stringify({ type: 'intent.message_mayor', city: a, payload: { text: 'hello' } });
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/api/events`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body });
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ 'x-world-request': '1' })).status, 201);
  });

  it('logout ends the session', async () => {
    const cookie = cookieOf(await login('marc', 'correct horse battery'));
    await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie } });
    assert.equal((await get('/api/me', cookie)).status, 401);
  });

  it('sessions expire after 7 days idle', async () => {
    const cookie = cookieOf(await login('marc', 'correct horse battery'));
    clock += 7 * 24 * 3_600_000 + 1;
    assert.equal((await get('/api/me', cookie)).status, 401);
  });

  it('serves the dashboard with a strict content security policy, and nothing outside public/', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type')!, /text\/html/);
    assert.match(res.headers.get('content-security-policy')!, /script-src 'self'/);
    assert.equal((await get('/../src/server/app.ts')).status, 404);
    assert.equal((await get('/%2e%2e/config/users.json')).status, 404);
  });
});
