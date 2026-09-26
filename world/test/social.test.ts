import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { Profiles, hashToken } from '../src/auth/profiles.ts';
import { worldView } from '../src/domain/view.ts';
import { createApp } from '../src/server/app.ts';
import { carryOut } from '../src/server/executor.ts';
import { MediaStore } from '../src/social/media.ts';
import { attachPublisher, type Connector } from '../src/social/publisher.ts';
import { TestWorld, dm, mayorOf, owner } from './helpers.ts';

const IMG = { ref: `media/${'a'.repeat(64)}.jpg`, kind: 'image' };
const VID = { ref: `media/${'b'.repeat(64)}.mp4`, kind: 'video' };
const marc = { dm: { id: 'marc-as-dm', role: 'dm' as const, writeScope: ['*'] }, mayor: (c: string) => ({ id: 'marc-as-mayor', role: 'mayor' as const, writeScope: [c] }) };

/** Marc's request, applied at once like the dashboard does (A19). */
function ask(w: TestWorld, city: string, type: string, payload: Record<string, unknown>) {
  const i = w.ledger.append(owner, { type: `intent.${type}`, city, payload });
  return carryOut(w.ledger, i, marc);
}

function setup() {
  const w = new TestWorld();
  const city = w.city('GGClutchPlays');
  const other = w.city('AI Receptionist City');
  const [ig] = ask(w, city, 'social_add_channel', { platform: 'instagram', handle: '@ggclutch', displayName: 'GG Clutch' }).slice(-1);
  const [yt] = ask(w, city, 'social_add_channel', { platform: 'youtube', handle: 'GGClutchPlays', displayName: 'GG Clutch Plays' }).slice(-1);
  return { w, city, other, ig: ig!.subject!, yt: yt!.subject! };
}

describe('social: channels', () => {
  it('adds a channel per city; the same handle twice is refused; another city cannot use it', () => {
    const { w, city, other, ig } = setup();
    assert.equal(w.state.social.channels.get(ig)!.platform, 'instagram');
    assert.throws(() => ask(w, city, 'social_add_channel', { platform: 'instagram', handle: '@GGCLUTCH', displayName: 'x' }), /already a channel/);
    assert.throws(() => ask(w, other, 'social_draft_post', { channelIds: [ig], text: 'hi' }), /belongs to/);
  });
});

describe('social: posts and approval (no auto-publish)', () => {
  it("Marc's draft is a draft; approving checks each platform's rules", () => {
    const { w, city, ig, yt } = setup();
    const [d] = ask(w, city, 'social_draft_post', { channelIds: [ig, yt], text: 'Clutch of the week' }).slice(-1);
    const post = d!.subject!;
    assert.equal(w.state.social.posts.get(post)!.status, 'draft');
    assert.throws(() => ask(w, city, 'social_approve_post', { postId: post }), /Instagram: needs a photo or video; YouTube: needs a video; YouTube: needs a title/);
    ask(w, city, 'social_edit_post', { postId: post, media: [VID], title: 'Insane 1v4 clutch' });
    ask(w, city, 'social_approve_post', { postId: post });
    assert.equal(w.state.social.posts.get(post)!.status, 'approved');
  });

  it('schedules only approved posts, never in the past', () => {
    const { w, city, ig } = setup();
    const [d] = ask(w, city, 'social_draft_post', { channelIds: [ig], text: 'hi', media: [IMG] }).slice(-1);
    const post = d!.subject!;
    assert.throws(() => ask(w, city, 'social_schedule_post', { postId: post, scheduledAt: '2026-10-01T15:00:00Z' }), /approve it before scheduling/);
    ask(w, city, 'social_approve_post', { postId: post });
    assert.throws(() => ask(w, city, 'social_schedule_post', { postId: post, scheduledAt: '2020-01-01T00:00:00Z' }), /in the past/);
    ask(w, city, 'social_schedule_post', { postId: post, scheduledAt: '2026-10-01T15:00:00Z' });
    assert.equal(w.state.social.posts.get(post)!.status, 'scheduled');
  });

  it("an agent's draft (through its Mayor) waits for Marc; it can't be published before he approves", () => {
    const { w, city, ig } = setup();
    const dept = w.department(city, w.district(city));
    const writer = w.agent(city, dept, 'Kai');
    const draft = { channelIds: [ig], text: 'New montage!', media: [IMG] };
    assert.throws(() => w.fact(mayorOf(city), { type: 'social.agent_drafted', city, payload: { ...draft, authorAgentId: writer } }), /only graduated agents/);
    w.promote(city, writer, 'probationer');
    const post = w.fact(mayorOf(city), { type: 'social.agent_drafted', city, payload: { ...draft, authorAgentId: writer } }).subject!;
    assert.equal(w.state.social.posts.get(post)!.status, 'pending');
    assert.throws(() => w.fact(dm, { type: 'social.post_published', city, payload: { postId: post, channelId: ig } }), /only a post Marc approved/);
    assert.throws(() => w.fact(mayorOf(city), { type: 'social.post_approved', city, payload: { postId: post } }), /authorizedBy/);
    ask(w, city, 'social_approve_post', { postId: post });
    w.fact(dm, { type: 'social.post_published', city, payload: { postId: post, channelId: ig, url: 'https://instagram.com/p/x' } });
    assert.equal(w.state.social.posts.get(post)!.status, 'published');
  });

  it('marking posted by hand, channel by channel: partial, then published', () => {
    const { w, city, ig, yt } = setup();
    const [d] = ask(w, city, 'social_draft_post', { channelIds: [ig, yt], text: 'x', title: 'X', media: [VID], approve: true }).slice(-1);
    const post = d!.subject!;
    ask(w, city, 'social_mark_posted', { postId: post, channelId: ig, url: 'https://instagram.com/p/1' });
    assert.equal(w.state.social.posts.get(post)!.status, 'partial');
    assert.throws(() => ask(w, city, 'social_mark_posted', { postId: post, channelId: ig }), /already published/);
    ask(w, city, 'social_mark_posted', { postId: post, channelId: yt });
    assert.equal(w.state.social.posts.get(post)!.status, 'published');
    assert.throws(() => ask(w, city, 'social_delete_post', { postId: post }), /published/);
  });

  it('the publisher posts due, approved posts through a connected connector, and records failures', async () => {
    const { w, city, ig, yt } = setup();
    const [d] = ask(w, city, 'social_draft_post', { channelIds: [ig, yt], text: 'x', title: 'T', media: [VID], approve: true, scheduledAt: '2026-09-25T13:00:00Z' }).slice(-1);
    const post = d!.subject!;
    const calls: string[] = [];
    const fake = (platform: 'instagram' | 'youtube', ok: boolean): Connector => ({
      platform,
      connected: () => true,
      publish: async (p) => {
        calls.push(`${platform}:${p.id}`);
        if (!ok) throw new Error('token expired');
        return { url: `https://${platform}.com/${p.id}` };
      },
    });
    const pub = attachPublisher(w.ledger, [fake('instagram', true), fake('youtube', false)], { everyMs: 1e9 });
    await pub.tick();
    assert.deepEqual(calls, [], 'not before its time');
    w.advanceHours(2);
    await pub.tick();
    pub.stop();
    const p = w.state.social.posts.get(post)!;
    assert.deepEqual(calls.sort(), [`instagram:${post}`, `youtube:${post}`]);
    assert.equal(p.results[ig]!.status, 'published');
    assert.equal(p.results[yt]!.error, 'token expired');
    assert.equal(p.status, 'partial');
  });
});

describe('social: inbox and metrics', () => {
  it('receives, replies, assigns to an agent of the city, closes; metrics are kept per channel and post', () => {
    const { w, city, other, ig } = setup();
    const item = w.fact(dm, { type: 'social.inbox_received', city, payload: { channelId: ig, kind: 'comment', from: '@fan', text: 'what settings?' } }).subject!;
    ask(w, city, 'social_reply', { itemId: item, text: 'Pinned in bio!' });
    const helper = w.collegeAgent(city, 'Rio');
    ask(w, city, 'social_assign', { itemId: item, agentId: helper });
    assert.throws(() => ask(w, city, 'social_assign', { itemId: item, agentId: w.collegeAgent(other, 'Zed') }), /not in/);
    ask(w, city, 'social_close', { itemId: item });
    const it = w.state.social.inbox.get(item)!;
    assert.deepEqual([it.replies.length, it.assignedTo, it.open], [1, helper, false]);
    w.fact(dm, { type: 'social.metrics', city, payload: { channelId: ig, date: '2026-09-25', followers: 1200, impressions: 5400 } });
    const view = worldView(w.state, owner, w.time).social;
    assert.equal(view.channels.find((c) => c.id === ig)!.series[0]!.followers, 1200);
    assert.equal(worldView(w.state, mayorOf(other), w.time).social.inbox.length, 0, "another city's Mayor sees none of it");
  });
});

describe('social: media upload', () => {
  it('stores by content hash, serves with Range, refuses unknown types', async () => {
    const w = new TestWorld();
    const media = new MediaStore(mkdtempSync(join(tmpdir(), 'media-')));
    const server = createApp(w.ledger, new Profiles([{ id: 'marc', role: 'owner', writeScope: ['*'], tokenSha256: hashToken('t') }]), { media });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = { authorization: 'Bearer t' };
    try {
      const body = Buffer.from('0123456789');
      const up = await (await fetch(`${base}/api/media`, { method: 'POST', headers: { ...auth, 'content-type': 'video/mp4' }, body })).json();
      assert.match(up.ref, /^media\/[0-9a-f]{64}\.mp4$/);
      assert.equal(up.kind, 'video');
      const part = await fetch(`${base}${up.url}`, { headers: { ...auth, range: 'bytes=2-4' } });
      assert.equal(part.status, 206);
      assert.equal(await part.text(), '234');
      assert.equal((await fetch(`${base}${up.url}`)).status, 401, 'signed-in only');
      assert.equal((await fetch(`${base}/api/media`, { method: 'POST', headers: { ...auth, 'content-type': 'application/pdf' }, body })).status, 400);
    } finally {
      server.close();
    }
  });
});

describe('social: hashtags, first comment, agents revising rejected posts', () => {
  it('hashtags count toward the caption; bad or duplicate tags are refused; YouTube takes them as tags', () => {
    const { w, city, ig, yt } = setup();
    assert.throws(() => ask(w, city, 'social_draft_post', { channelIds: [ig], text: 'x', tags: ['has space'] }), /hashtags/);
    assert.throws(() => ask(w, city, 'social_draft_post', { channelIds: [ig], text: 'x', tags: ['Clutch', 'clutch'] }), /duplicates/);
    const text = 'a'.repeat(2190);
    assert.throws(() => ask(w, city, 'social_draft_post', { channelIds: [ig], text, media: [IMG], tags: ['clutch', 'valorant'], approve: true }), /Instagram: text with hashtags is 2209 characters/);
    const [d] = ask(w, city, 'social_draft_post', { channelIds: [yt], text, title: 'T', media: [VID], tags: ['clutch', 'valorant'], firstComment: 'Settings in bio', approve: true }).slice(-1);
    const post = w.state.social.posts.get(d!.subject!)!;
    assert.deepEqual(post.tags, ['clutch', 'valorant']);
    assert.equal(post.firstComment, 'Settings in bio');
    ask(w, city, 'social_edit_post', { postId: post.id, firstComment: '' });
    assert.equal(w.state.social.posts.get(post.id)!.firstComment, null, 'an empty first comment clears it');
  });

  it("a rejected agent post goes back to the agent, who revises it; it waits for Marc again", async () => {
    const { w, city, ig } = setup();
    const dept = w.department(city, w.district(city));
    const writer = w.agent(city, dept, 'Kai');
    w.promote(city, writer, 'probationer');
    const post = w.fact(mayorOf(city), { type: 'social.agent_drafted', city, payload: { channelIds: [ig], text: 'Call us!!!', media: [IMG], authorAgentId: writer } }).subject!;
    assert.throws(() => w.fact(mayorOf(city), { type: 'social.agent_revised', city, payload: { postId: post, text: 'x' } }), /only posts Marc rejected/);
    ask(w, city, 'social_reject_post', { postId: post, reason: 'Say what we do' });
    const mine = ask(w, city, 'social_draft_post', { channelIds: [ig], text: 'mine' }).at(-1)!.subject!;
    ask(w, city, 'social_reject_post', { postId: mine, reason: 'no' });
    assert.throws(() => w.fact(mayorOf(city), { type: 'social.agent_revised', city, payload: { postId: mine, text: 'x' } }), /not drafted by an agent/);
    w.fact(mayorOf(city), { type: 'social.agent_revised', city, payload: { postId: post, text: 'We answer every call and book it.', tags: ['booking'], note: 'Added what we do' } });
    const p = w.state.social.posts.get(post)!;
    assert.equal(p.status, 'pending');
    assert.equal(p.revisions, 1);
    assert.equal(p.rejectReason, 'Say what we do', 'the last feedback stays visible');
    assert.match(p.history.at(-1)!.what, /revised by agent/);
  });
});

describe('talking to an agent', () => {
  it("Marc's message routes to the Mayor; the agent's answer is written by its Mayor bot", () => {
    const w = new TestWorld();
    const city = w.city();
    const other = w.city('Other City');
    const dept = w.department(city, w.district(city));
    const kai = w.agent(city, dept, 'Kai');
    const msg = ask(w, city, 'message_agent', { agentId: kai, text: 'How is the booking going?' });
    assert.equal(msg.length, 1, 'routed; nothing else to carry out');
    const intentSeq = (msg[0]!.payload as { intentSeq: number }).intentSeq;
    assert.throws(() => ask(w, other, 'message_agent', { agentId: kai, text: 'hi' }), /not in/);
    assert.throws(() => w.fact(mayorOf(other), { type: 'agent.said', city: other, subject: kai, payload: { text: 'hi' } }), /./);
    assert.throws(() => w.fact(mayorOf(city), { type: 'agent.said', city, subject: kai, payload: { text: 'hi', replyTo: 1 } }), /not a message to/);
    w.fact(mayorOf(city), { type: 'agent.said', city, subject: kai, payload: { text: 'Three booked today.', replyTo: intentSeq } });
    const chat = w.state.chats.get(kai)!;
    assert.deepEqual(chat.map((m) => [m.from, m.text]), [['marc', 'How is the booking going?'], ['agent', 'Three booked today.']]);
    const view = worldView(w.state, { id: `mayor-${other}`, role: 'mayor', writeScope: [other] }, w.time);
    assert.deepEqual(view.chats, {}, "another city's Mayor doesn't see it");
    assert.equal(worldView(w.state, { id: 'marc', role: 'owner', writeScope: ['*'] }, w.time).chats[kai]!.length, 2);
  });
});

describe('demo world', () => {
  it('builds with the Social sample through the real write path', async () => {
    const { execFileSync } = await import('node:child_process');
    const { Ledger } = await import('../src/ledger/ledger.ts');
    const db = join(mkdtempSync(join(tmpdir(), 'demo-')), 'demo.db');
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/demo.ts'], { env: { ...process.env, WORLD_DEMO_DB: db }, stdio: 'pipe' });
    const ledger = new Ledger({ path: db });
    const s = ledger.state.social;
    assert.equal([...s.channels.values()].length, 5);
    const statuses = new Set([...s.posts.values()].map((p) => p.status));
    for (const st of ['published', 'pending', 'draft', 'rejected', 'scheduled']) assert.ok(statuses.has(st as never), st);
    assert.ok([...s.inbox.values()].length >= 6);
    assert.ok([...s.channelMetrics.values()].every((m) => m.size >= 60));
    ledger.close();
  });
});
