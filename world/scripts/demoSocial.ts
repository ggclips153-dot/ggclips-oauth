// Sample Social data for the DEMO world: channels for two brands, posts in every state (agent drafts waiting
// for approval, drafts, a rejected post, scheduled, one due to post by hand, published with metrics), inbox
// items and 60 days of channel metrics. Every event goes through the real write path.
//   npm run demo:social     (adds it to an existing data/demo.db; stop the demo server first)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { Profile } from '../src/ledger/guard.ts';
import { Ledger } from '../src/ledger/ledger.ts';

const DAY = 86_400_000;

/** A small neon poster as a PNG (no image library needed). */
function poster(seed: number, w = 480, hgt = 480): Buffer {
  const hues: [number, number, number][] = [[42, 120, 214], [235, 104, 52], [27, 175, 122], [237, 161, 0], [180, 60, 220]];
  const a = hues[seed % hues.length]!;
  const b = hues[(seed + 2) % hues.length]!;
  const raw = Buffer.alloc((w * 3 + 1) * hgt);
  for (let y = 0; y < hgt; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + hgt);
      const dx = x - w * 0.5;
      const dy = y - hgt * 0.55;
      const ring = Math.abs(Math.hypot(dx, dy) - 140 - (seed % 3) * 20) < 6 ? 1 : 0;
      const grid = x % 40 === 0 || y % 40 === 0 ? 0.25 : 0;
      const dark = 0.18 + 0.5 * (y / hgt);
      for (let c = 0; c < 3; c++) {
        const base = (a[c]! * (1 - t) + b[c]! * t) * dark;
        raw[row + 1 + x * 3 + c] = Math.min(255, Math.round(base + ring * 230 + grid * 90));
      }
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(hgt, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Add the sample social data. `setNow` moves the ledger's clock so past posts carry past dates; it is reset
 * to real time at the end.
 */
export function seedSocial(ledger: Ledger, mediaDir: string, setNow: (ms: number | null) => void) {
  const marc: Profile = { id: 'marc', role: 'owner', writeScope: ['*'] };
  const dm: Profile = { id: 'dm', role: 'dm', writeScope: ['*'] };
  const mayor = (city: string): Profile => ({ id: `mayor-${city}`, role: 'mayor', writeScope: [city] });
  const st = ledger.state;
  const cityNamed = (name: string) => [...st.cities.values()].find((c) => c.name === name)?.id;
  const gaming = cityNamed('GGClutchPlays');
  const reception = cityNamed('AI Receptionist City');
  if (!gaming || !reception) throw new Error('the demo world needs GGClutchPlays and AI Receptionist City');
  if ([...st.social.channels.values()].length) throw new Error('this world already has social channels');
  const graduates = (c: string) => [...st.agents.values()].filter((a) => a.cityId === c && a.role === 'agent' && !a.deleted && ['probationer', 'active', 'senior'].includes(a.state)).map((a) => a.id);

  const now = Date.now();
  const at = (ms: number) => setNow(ms);
  const request = (type: string, city: string, payload: Record<string, unknown>) => {
    const i = ledger.append(marc, { type: `intent.${type}`, city, payload });
    ledger.append(dm, { type: 'dm.routed', city, payload: { intentSeq: i.seq, to: `mayor:${city}` } });
    return i;
  };
  const carry = (type: string, city: string, payload: Record<string, unknown>) => {
    const i = request(`social_${type}`, city, payload);
    const fact = { add_channel: 'channel_added', draft_post: 'post_drafted', approve_post: 'post_approved', reject_post: 'post_rejected', schedule_post: 'post_scheduled', reply: 'inbox_replied', assign: 'inbox_assigned', close: 'inbox_closed' }[type]!;
    return ledger.append(mayor(city), { type: `social.${fact}`, city, payload, authorizedBy: i.seq }).subject;
  };
  const media = (seed: number) => {
    const png = poster(seed);
    const name = `${createHash('sha256').update(png).digest('hex')}.png`;
    mkdirSync(mediaDir, { recursive: true });
    if (!existsSync(resolve(mediaDir, name))) writeFileSync(resolve(mediaDir, name), png);
    return { ref: `media/${name}`, kind: 'image' as const };
  };
  // Videos: the demo can't make real clips, so these point at a video that isn't there (shown as "▶ video").
  const video = (n: number) => ({ ref: `media/${createHash('sha256').update(`demo-video-${n}`).digest('hex')}.mp4`, kind: 'video' as const });

  // ---- channels (60 days ago) ----
  at(now - 62 * DAY);
  const yt = carry('add_channel', gaming, { platform: 'youtube', handle: '@GGClutchPlays', displayName: 'GGClutchPlays' })!;
  const tt = carry('add_channel', gaming, { platform: 'tiktok', handle: '@ggclutchplays', displayName: 'GGClutchPlays' })!;
  const ig = carry('add_channel', gaming, { platform: 'instagram', handle: '@ggclutchplays', displayName: 'GGClutchPlays' })!;
  const fb = carry('add_channel', reception, { platform: 'facebook', handle: 'AI Receptionist', displayName: 'AI Receptionist' })!;
  const ig2 = carry('add_channel', reception, { platform: 'instagram', handle: '@ai.receptionist', displayName: 'AI Receptionist' })!;
  const channels = [
    { id: yt, city: gaming, followers: 3200, growth: 28, impressions: 5200 },
    { id: tt, city: gaming, followers: 8100, growth: 95, impressions: 21000 },
    { id: ig, city: gaming, followers: 2400, growth: 14, impressions: 3900 },
    { id: fb, city: reception, followers: 640, growth: 4, impressions: 900 },
    { id: ig2, city: reception, followers: 410, growth: 6, impressions: 700 },
  ];

  // ---- published posts, spread over the last weeks ----
  const published = [
    { city: gaming, ch: [yt, tt], days: 26, title: '1v4 clutch on Ascent', text: 'Down to one, 40 seconds on the clock. How would you have played it? #valorant #clutch', media: [video(1)] },
    { city: gaming, ch: [tt], days: 19, text: 'This flick should be illegal 😤 #fps #highlights', media: [video(2)] },
    { city: gaming, ch: [ig], days: 15, text: 'Setup reveal: what we clip with every night. Full list in bio.', media: [media(1), media(2)] },
    { city: gaming, ch: [yt, tt, ig], days: 9, title: 'Top 5 clutches of the month', text: 'Five rounds nobody should have won. Vote for your favourite in the comments.', media: [video(3)] },
    { city: reception, ch: [fb, ig2], days: 12, text: 'Missed calls are missed bookings. Our AI receptionist answers every call, books the appointment and sends the reminder.', media: [media(3)] },
    { city: reception, ch: [fb], days: 5, text: 'Bright Smile Dental booked 38 cleanings last week without picking up the phone once. Ask us how.', media: [] },
  ];
  // IG with a video post needs to allow video: Instagram takes photos or videos, so the video post above is fine.
  const postIds: { id: string; ch: string[]; days: number; city: string }[] = [];
  for (const p of published) {
    at(now - (p.days + 2) * DAY);
    const id = carry('draft_post', p.city, { channelIds: p.ch, text: p.text, ...(p.title ? { title: p.title } : {}), media: p.media, approve: true, scheduledAt: new Date(now - p.days * DAY).toISOString() })!;
    at(now - p.days * DAY + 60_000);
    for (const c of p.ch) ledger.append(dm, { type: 'social.post_published', city: p.city, payload: { postId: id, channelId: c, manual: true } });
    postIds.push({ id, ch: p.ch, days: p.days, city: p.city });
  }

  // ---- daily channel metrics, 60 days ----
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let d = 60; d >= 0; d--) {
    at(now - d * DAY + 3_600_000);
    const date = new Date(now - d * DAY).toISOString().slice(0, 10);
    for (const ch of channels) {
      const boost = postIds.some((p) => p.ch.includes(ch.id) && p.days >= d && p.days - d < 3) ? 2.2 : 1;
      ledger.append(dm, {
        type: 'social.metrics',
        city: ch.city,
        payload: {
          channelId: ch.id,
          date,
          followers: Math.round(ch.followers + ch.growth * (60 - d) * boost ** 0.2 + rnd() * ch.growth),
          impressions: Math.round(ch.impressions * (0.7 + rnd() * 0.6) * boost),
          reach: Math.round(ch.impressions * 0.6 * (0.7 + rnd() * 0.6) * boost),
        },
      });
    }
  }
  // Per-post results, reported a day after each post went out.
  for (const p of postIds) {
    at(now - Math.max(0, p.days - 1) * DAY);
    for (const c of p.ch) {
      const big = c === tt ? 4 : c === yt ? 2 : 1;
      const views = Math.round((1500 + rnd() * 6000) * big);
      ledger.append(dm, {
        type: 'social.metrics',
        city: p.city,
        payload: { channelId: c, postId: p.id, date: new Date(now - p.days * DAY).toISOString().slice(0, 10), views, impressions: Math.round(views * 1.3), likes: Math.round(views * (0.04 + rnd() * 0.05)), comments: Math.round(views * 0.006), shares: Math.round(views * 0.004), saves: Math.round(views * 0.003) },
      });
    }
  }

  // ---- today: plan, approvals, inbox ----
  at(now - 2 * 3_600_000);
  // Agent drafts waiting for Marc (written by the city's Mayor for a graduated agent).
  const [gAgent] = graduates(gaming);
  const [rAgent] = graduates(reception);
  if (gAgent) {
    ledger.append(mayor(gaming), { type: 'social.agent_drafted', city: gaming, payload: { channelIds: [tt, yt], title: 'Ace with a pistol only', text: 'Pistol round ace, no armour, no excuses. #clutch #ace', media: [video(4)], authorAgentId: gAgent, note: 'Cut from last night\'s stream, 0:58 long; passed QC.' } });
    ledger.append(mayor(gaming), { type: 'social.agent_drafted', city: gaming, payload: { channelIds: [ig], text: 'Which map should we grind this week? Vote in the comments 👇', media: [media(4)], authorAgentId: gAgent } });
  }
  if (rAgent) ledger.append(mayor(reception), { type: 'social.agent_drafted', city: reception, payload: { channelIds: [fb], text: 'HVAC season is here. Every after-hours call answered, every service call booked. Try it free for 14 days.', media: [], authorAgentId: rAgent, note: 'For the fall HVAC push.' } });
  // A draft of Marc's, and a rejected one.
  carry('draft_post', gaming, { channelIds: [yt], text: 'Weekly recap: best plays, worst fails.', media: [] });
  const rej = carry('draft_post', reception, { channelIds: [ig2], text: 'Call us!!!', media: [media(5)] })!;
  carry('reject_post', reception, { postId: rej, reason: 'Too thin: say what the receptionist does and add the booking link.' });
  // Scheduled for the coming days, and one due now (post it by hand, then mark it posted).
  for (const [d, hr, city, ch, text, m, title] of [
    [1, 18, gaming, [tt], 'Clutch or kick? You decide. #valorant', [video(5)], null],
    [2, 17, gaming, [yt, tt], 'Ranked grind day 30: finally Immortal?', [video(6)], 'Road to Immortal: day 30'],
    [3, 12, reception, [fb, ig2], 'Meet Ana, the Mayor of our AI Receptionist City. She keeps every desk staffed around the clock.', [media(6)], null],
    [6, 19, gaming, [ig], 'Behind the scenes: how a clip goes from stream to your feed.', [media(7), media(8)], null],
  ] as const) {
    const t = new Date(now + d * DAY);
    t.setUTCHours(hr, 0, 0, 0);
    carry('draft_post', city, { channelIds: [...ch], text, media: [...m], ...(title ? { title } : {}), approve: true, scheduledAt: t.toISOString() });
  }
  at(now - 5 * 60_000);
  carry('draft_post', gaming, { channelIds: [tt, ig], text: 'New clip drops tonight at 8. Turn on notifications 🔔', media: [video(7)], approve: true, scheduledAt: new Date(now - 4 * 60_000).toISOString() });

  // Inbox: comments, messages and a mention.
  const inbox = [
    [gaming, yt, 'comment', '@aimgod', 'That last round was insane, what crosshair do you use?', postIds[0]?.id],
    [gaming, tt, 'comment', '@viper.mains', 'Clip of the year no cap', postIds[3]?.id],
    [gaming, ig, 'dm', '@esports.hub', 'Hey! We run a weekly highlights show and would love to feature your clips. Open to a collab?', null],
    [reception, fb, 'dm', 'Dr. Lina Park', 'Does this work with our current phone number? We are a two-chair practice.', null],
    [reception, ig2, 'mention', '@brightsmile.dental', 'Shout-out to @ai.receptionist for filling our schedule this month!', null],
    [reception, fb, 'comment', 'Tom Reyes', 'What does it cost per month?', postIds[5]?.id],
  ] as const;
  const items: string[] = [];
  for (const [n, [city, channelId, kind, from, text, postId]] of inbox.entries()) {
    at(now - (6 - n) * 3_600_000);
    items.push(ledger.append(dm, { type: 'social.inbox_received', city, payload: { channelId, kind, from, text, ...(postId ? { postId } : {}) } }).subject!);
  }
  at(now - 30 * 60_000);
  carry('reply', gaming, { itemId: items[0], text: 'Thanks! Small cyan dot, no outline. Full settings in the pinned comment.' });
  carry('close', gaming, { itemId: items[0] });
  if (rAgent) carry('assign', reception, { itemId: items[3], agentId: rAgent });

  setNow(null);
}

// Run on its own: add the sample to an existing demo world.
if (import.meta.main ?? process.argv[1]?.endsWith('demoSocial.ts')) {
  const path = resolve(import.meta.dirname, '..', process.env.WORLD_DEMO_DB ?? 'data/demo.db');
  if (resolve(path) === resolve(import.meta.dirname, '..', 'data/world.db')) throw new Error('refusing to write demo data into the real ledger');
  if (!existsSync(path)) {
    console.error(`${path} doesn't exist yet: run npm run demo first.`);
    process.exit(1);
  }
  let shift: number | null = null;
  const ledger = new Ledger({ path, now: () => new Date(shift ?? Date.now()) });
  try {
    seedSocial(ledger, resolve(import.meta.dirname, '..', 'data/media'), (ms) => (shift = ms));
    console.log(`Social sample added to ${path} (${ledger.state.lastSeq} events).`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    ledger.close();
  }
}
