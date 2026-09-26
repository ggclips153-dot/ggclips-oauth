// The Social tab: plan, approve and publish posts on each city's channels (Instagram, Facebook, TikTok,
// YouTube), a unified inbox, and analytics. Everything here reads the ledger's projection (data.social) and
// writes Marc's requests, which the server applies at once (A19). Nothing is published without his approval.
import { h, s } from './dom.js';
import { confirmTwice, openForm } from './forms.js';

const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'];
const PLAT = {
  instagram: { label: 'Instagram', short: 'IG' },
  facebook: { label: 'Facebook', short: 'FB' },
  tiktok: { label: 'TikTok', short: 'TT' },
  youtube: { label: 'YouTube', short: 'YT' },
};
const STATUS = {
  draft: ['Draft', null],
  pending: ['Needs approval', 'warning'],
  approved: ['Approved', 'good'],
  scheduled: ['Scheduled', 'good'],
  published: ['Published', 'good'],
  partial: ['Partly published', 'warning'],
  failed: ['Failed', 'critical'],
  rejected: ['Rejected', 'serious'],
};
const SECTIONS = [
  ['calendar', 'Calendar'],
  ['posts', 'Posts'],
  ['approvals', 'Approvals'],
  ['inbox', 'Inbox'],
  ['analytics', 'Analytics'],
  ['channels', 'Channels'],
];
/** What each platform needs before it can connect for real posting (shown on the Channels page). */
const CONNECT_NEEDS = {
  instagram: 'A Meta developer app with Instagram Graph API (instagram_content_publish), a Business/Creator account linked to a Facebook Page, and a long-lived token.',
  facebook: 'A Meta developer app with pages_manage_posts and pages_read_engagement, and a Page access token.',
  tiktok: 'TikTok for Developers access to the Content Posting API (video.publish), and the account\'s OAuth token.',
  youtube: 'A Google Cloud project with the YouTube Data API v3 enabled, OAuth consent, and the channel\'s refresh token.',
};

const BRAND_KEY = 'social.brand';
const readBrand = () => {
  try {
    return localStorage.getItem(BRAND_KEY) ?? '';
  } catch {
    return '';
  }
};
const writeBrand = (v) => {
  try {
    localStorage.setItem(BRAND_KEY, v);
  } catch {
    /* per-viewer convenience only */
  }
};
/** Open the Social tab on one city's channels (used from a city's page). */
export function openSocialFor(cityId) {
  writeBrand(cityId);
  location.hash = '#/social/calendar';
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localInput = (iso) => {
  const d = new Date(iso);
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');
const pct = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 });
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const mediaUrl = (ref) => (ref.startsWith('media/') ? `/${ref}` : ref);

/** The Social tab. `sub` is the section (calendar, posts…); ctx carries the dashboard's data and helpers. */
export function socialPage(ctx, sub) {
  const { data } = ctx;
  const section = SECTIONS.some(([k]) => k === sub) ? sub : 'calendar';
  const cities = data.cities;
  let brand = readBrand();
  if (brand && !cities.some((c) => c.id === brand)) brand = '';
  const inBrand = (cityId) => !brand || cityId === brand;
  const S = data.social;
  const view = {
    ...ctx,
    brand,
    cities,
    channels: S.channels.filter((c) => inBrand(c.cityId)),
    posts: S.posts.filter((p) => inBrand(p.cityId)),
    inbox: S.inbox.filter((i) => inBrand(i.cityId)),
    platforms: S.platforms,
    channel: (id) => S.channels.find((c) => c.id === id),
    cityName: (id) => cities.find((c) => c.id === id)?.name ?? id,
  };
  const due = view.posts.filter((p) => p.due);
  const pending = view.posts.filter((p) => p.status === 'pending');
  const openInbox = view.inbox.filter((i) => i.open);

  const brandPicker = h('select', {
    'aria-label': 'Brand (city)',
    onchange: (ev) => {
      writeBrand(ev.target.value);
      ctx.render();
    },
  },
  h('option', { value: '' }, 'All brands'),
  cities.map((c) => h('option', { value: c.id, selected: c.id === brand }, c.name)));

  const counts = { approvals: pending.length, inbox: openInbox.length, posts: due.length };
  const nav = h('nav', { class: 'soc-nav', 'aria-label': 'Social sections' },
    SECTIONS.map(([k, label]) =>
      h('a', { href: `#/social/${k}`, 'aria-current': k === section ? 'page' : null }, label,
        counts[k] ? h('span', { class: `count-pill${k === 'posts' || k === 'approvals' ? ' alert' : ''}` }, counts[k]) : null)));

  const body = {
    calendar: () => calendarSection(view),
    posts: () => postsSection(view),
    approvals: () => approvalsSection(view),
    inbox: () => inboxSection(view),
    analytics: () => analyticsSection(view),
    channels: () => channelsSection(view),
  }[section]();

  return [
    h('div', { class: 'page-head' },
      h('h1', {}, 'Social'),
      h('div', { class: 'toolbar' }, brandPicker, ctx.isOwner() && h('button', { type: 'button', class: 'primary', onclick: () => compose(view) }, '+ Create post'))),
    due.length ? dueBanner(view, due) : null,
    h('div', { class: 'soc-layout' }, nav, h('div', { class: 'soc-body' }, body)),
  ];
}

// ---------- shared pieces ----------
function platformBadge(platform) {
  return h('span', { class: `plat plat-${platform}`, title: PLAT[platform].label }, PLAT[platform].short);
}
function channelChip(v, id) {
  const ch = v.channel(id);
  if (!ch) return h('span', { class: 'muted small' }, id);
  return h('span', { class: 'chan-chip' }, platformBadge(ch.platform), ch.handle);
}
function statusOf(v, post) {
  if (post.due) return v.statusChip('warning', 'Due: post by hand');
  const [label, kind] = STATUS[post.status] ?? [post.status, null];
  return kind ? v.statusChip(kind, label) : h('span', { class: 'chip' }, label);
}
function authorOf(v, post) {
  if (post.author.kind === 'owner') return 'You';
  const a = v.index().agents.get(post.author.id);
  return a ? `${a.name} (agent)` : post.author.id;
}
function mediaThumb(m, { big = false } = {}) {
  const url = mediaUrl(m.ref);
  const box = h('div', { class: `thumb${big ? ' big' : ''}` });
  const fallback = () => box.replaceChildren(h('span', { class: 'thumb-ph' }, m.kind === 'video' ? '▶ video' : 'image'));
  if (m.kind === 'video') {
    const vid = h('video', { src: url, muted: true, preload: 'metadata', playsinline: true, controls: big || null });
    vid.addEventListener('error', fallback);
    box.append(vid);
  } else {
    const img = h('img', { src: url, alt: '', loading: 'lazy' });
    img.addEventListener('error', fallback);
    box.append(img);
  }
  return box;
}
/** Send a request; the server applies it at once or says why not. */
async function send(v, type, city, payload) {
  const e = await v.api('/api/events', { method: 'POST', body: { type, city, payload } });
  if (e.applied === false) throw new Error(e.reason);
  v.scheduleRefresh();
  return e;
}
const run = (v, fn, ok) => async () => {
  try {
    await fn();
    if (ok) v.toast(ok);
  } catch (err) {
    v.toast(err.message);
  }
};

function dueBanner(v, due) {
  return h('div', { class: 'card section soc-due', role: 'status' },
    h('b', {}, `${due.length} post(s) due now`),
    h('span', { class: 'small secondary' }, ' · not connected to the platform yet, so post them by hand and mark them posted.'),
    h('div', { class: 'toolbar' }, due.slice(0, 4).map((p) => h('button', { type: 'button', class: 'small-btn', onclick: () => postDetail(v, p) }, clip(p.title || p.text || p.id, 32)))));
}

// ---------- compose ----------
/** Create or edit a post: channels, text with per-platform counts, media, preview, then draft / approve / schedule. */
function compose(v, post = null) {
  const editing = !!post;
  const cityOfChannel = (id) => v.channel(id)?.cityId;
  let city = post?.cityId ?? v.brand ?? '';
  const pickable = () => (city ? v.channels.filter((c) => c.cityId === city) : v.channels);
  const state = {
    channelIds: new Set(post?.channelIds ?? []),
    media: [...(post?.media ?? [])],
  };
  const dialog = h('dialog', { class: 'modal compose' });
  const error = h('p', { class: 'error', role: 'alert' });
  const text = h('textarea', { rows: 6, placeholder: 'Write your post…', 'aria-label': 'Post text' });
  text.value = post?.text ?? '';
  const title = h('input', { type: 'text', placeholder: 'Video title (YouTube)', 'aria-label': 'Title' });
  title.value = post?.title ?? '';
  const firstComment = h('input', { type: 'text', placeholder: 'First comment (optional)', 'aria-label': 'First comment' });
  firstComment.value = post?.firstComment ?? '';
  const channelsBox = h('div', { class: 'chan-pick', role: 'group', 'aria-label': 'Channels' });
  const counters = h('div', { class: 'counters small' });
  const problemsBox = h('ul', { class: 'problems small' });
  const mediaBox = h('div', { class: 'media-row' });
  const preview = h('div', { class: 'previews' });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm', multiple: true, hidden: true });
  const when_ = h('select', { 'aria-label': 'When' },
    h('option', { value: 'draft' }, 'Save as draft'),
    h('option', { value: 'approve' }, 'Approve (post later)'),
    h('option', { value: 'schedule' }, 'Approve and schedule'));
  const at = h('input', { type: 'datetime-local', 'aria-label': 'Scheduled time' });
  if (post?.scheduledAt) {
    when_.value = 'schedule';
    at.value = localInput(post.scheduledAt);
  } else {
    const soon = new Date(Date.now() + 3600_000);
    soon.setMinutes(0, 0, 0);
    at.value = localInput(soon.toISOString());
  }
  if (editing) when_.hidden = at.hidden = true;
  const submit = h('button', { type: 'submit', class: 'primary' }, editing ? 'Save changes' : 'Save draft');

  const selectedPlatforms = () => [...new Set([...state.channelIds].map((id) => v.channel(id)?.platform).filter(Boolean))];
  const problems = () => {
    const out = [];
    for (const pl of selectedPlatforms()) {
      const r = v.platforms[pl];
      if (text.value.length > r.maxText) out.push(`${r.label}: ${text.value.length}/${r.maxText} characters`);
      if (r.needsMedia && !state.media.length) out.push(`${r.label}: needs ${r.videoOnly ? 'a video' : 'a photo or video'}`);
      if (r.videoOnly && state.media.some((m) => m.kind !== 'video')) out.push(`${r.label}: video only`);
      if (state.media.length > r.maxMedia) out.push(`${r.label}: at most ${r.maxMedia} file(s)`);
      if (r.titleMax && !title.value.trim()) out.push(`${r.label}: needs a title`);
    }
    return out;
  };
  const refresh = () => {
    channelsBox.replaceChildren(
      ...(pickable().length
        ? pickable().map((c) => h('button', {
            type: 'button',
            class: 'chan-toggle',
            'aria-pressed': String(state.channelIds.has(c.id)),
            onclick: () => {
              if (state.channelIds.has(c.id)) state.channelIds.delete(c.id);
              else {
                // One brand per post: picking a channel of another city starts over with that city.
                if (city && c.cityId !== city) state.channelIds.clear();
                city = c.cityId;
                state.channelIds.add(c.id);
              }
              refresh();
            },
          }, platformBadge(c.platform), h('span', {}, c.handle), h('span', { class: 'muted small' }, v.cityName(c.cityId))))
        : [h('p', { class: 'muted small' }, 'No channels yet. Add one on the Channels page.')]),
    );
    const plats = selectedPlatforms();
    counters.replaceChildren(...plats.map((pl) => {
      const r = v.platforms[pl];
      const over = text.value.length > r.maxText;
      return h('span', { class: over ? 'over' : '' }, `${r.label} ${whole.format(text.value.length)}/${whole.format(r.maxText)}`);
    }));
    title.hidden = !plats.includes('youtube');
    firstComment.hidden = !plats.some((pl) => pl === 'instagram' || pl === 'facebook');
    mediaBox.replaceChildren(
      ...state.media.map((m, i) => h('div', { class: 'media-item' }, mediaThumb(m),
        h('button', { type: 'button', class: 'small-btn', 'aria-label': 'Remove', onclick: () => { state.media.splice(i, 1); refresh(); } }, '×'))),
      h('button', { type: 'button', class: 'small-btn', onclick: () => file.click() }, '+ Photo / video'),
      h('button', { type: 'button', class: 'small-btn', onclick: () => {
        const url = prompt('Link to a photo or video (https://…)');
        if (!url) return;
        if (!/^https:\/\/\S+$/.test(url)) return v.toast('Use a full https:// link.');
        state.media.push({ ref: url, kind: /\.(mp4|mov|webm)(\?|$)/i.test(url) ? 'video' : 'image' });
        refresh();
      } }, '+ From link'),
    );
    const list = problems();
    problemsBox.replaceChildren(...list.map((p) => h('li', {}, p)));
    submit.textContent = editing ? 'Save changes' : { draft: 'Save draft', approve: 'Approve', schedule: 'Approve and schedule' }[when_.value];
    at.hidden = editing || when_.value !== 'schedule';
    preview.replaceChildren(...(plats.length ? plats.map((pl) => previewCard(v, pl, [...state.channelIds].map(v.channel).find((c) => c?.platform === pl), text.value, title.value, state.media)) : [h('p', { class: 'muted small' }, 'Pick a channel to see a preview.')]));
  };
  file.addEventListener('change', async () => {
    for (const f of file.files) {
      try {
        error.textContent = `Uploading ${f.name}…`;
        const res = await fetch('/api/media', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': f.type, 'x-world-request': '1' }, body: f });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || `upload failed (${res.status})`);
        state.media.push({ ref: json.ref, kind: json.kind });
        error.textContent = '';
      } catch (err) {
        error.textContent = `${f.name}: ${err.message}`;
      }
    }
    file.value = '';
    refresh();
  });
  for (const el of [text, title]) el.addEventListener('input', refresh);
  when_.addEventListener('change', refresh);

  let busy = false;
  const save = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    error.textContent = '';
    if (!state.channelIds.size) return (error.textContent = 'Pick at least one channel.');
    const payload = {
      channelIds: [...state.channelIds],
      text: text.value,
      ...(title.value.trim() && !title.hidden ? { title: title.value.trim() } : {}),
      media: state.media,
      ...(firstComment.value.trim() && !firstComment.hidden ? { firstComment: firstComment.value.trim() } : {}),
    };
    const cityId = cityOfChannel(payload.channelIds[0]);
    busy = true;
    submit.disabled = true;
    try {
      if (editing) {
        await send(v, 'intent.social_edit_post', cityId, { postId: post.id, ...payload });
        v.toast('Post updated.');
      } else {
        const mode = when_.value;
        if (mode !== 'draft' && problems().length) throw new Error('Fix the items above first, or save it as a draft.');
        const scheduledAt = mode === 'schedule' ? new Date(at.value).toISOString() : undefined;
        await send(v, 'intent.social_draft_post', cityId, { ...payload, ...(mode !== 'draft' ? { approve: true } : {}), ...(scheduledAt ? { scheduledAt } : {}) });
        v.toast(mode === 'draft' ? 'Draft saved.' : mode === 'schedule' ? `Scheduled for ${when(scheduledAt)}.` : 'Approved.');
      }
      dialog.close();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      busy = false;
      submit.disabled = false;
    }
  };

  dialog.append(h('form', { onsubmit: save },
    h('h2', {}, editing ? 'Edit post' : 'Create post'),
    h('div', { class: 'compose-grid' },
      h('div', { class: 'compose-main' },
        h('label', { class: 'small secondary' }, 'Channels'), channelsBox,
        title, text, counters,
        h('label', { class: 'small secondary' }, 'Photos and videos'), mediaBox, file,
        firstComment,
        h('div', { class: 'compose-when' }, when_, at),
        problemsBox, error),
      h('div', { class: 'compose-preview' }, h('div', { class: 'small secondary' }, 'Preview'), preview)),
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'), submit)));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  refresh();
  dialog.showModal();
}

/** A simple look at how the post reads on a platform (not a pixel copy of the platform's app). */
function previewCard(v, platform, channel, text, title, media) {
  const lim = v.platforms[platform].maxText;
  return h('div', { class: `preview preview-${platform}` },
    h('div', { class: 'preview-head' }, platformBadge(platform), h('b', {}, channel?.displayName ?? PLAT[platform].label), h('span', { class: 'muted small' }, channel?.handle ?? '')),
    media.length ? mediaThumb(media[0], { big: true }) : null,
    platform === 'youtube' && title ? h('div', { class: 'preview-title' }, title) : null,
    h('div', { class: 'preview-text' }, text.length > 280 ? `${text.slice(0, 280)}… more` : text || h('span', { class: 'muted' }, 'Your text appears here')),
    text.length > lim ? h('div', { class: 'error small' }, `Too long for ${PLAT[platform].label}`) : null);
}

// ---------- post detail & actions ----------
function postDetail(v, post) {
  const dialog = h('dialog', { class: 'modal' });
  const close = () => dialog.close();
  const owner = v.isOwner();
  const act = (label, fn, cls = '') => (owner ? h('button', { type: 'button', class: `small-btn ${cls}`.trim(), onclick: async () => { await fn(); } }, label) : null);
  const results = post.channelIds.map((id) => {
    const r = post.results[id];
    const m = post.metrics?.[id];
    const done = r?.status === 'published';
    return h('li', {},
      channelChip(v, id), ' ',
      r ? (done ? v.statusChip('good', r.manual ? 'Posted by hand' : 'Published') : v.statusChip('critical', `Failed: ${r.error}`)) : h('span', { class: 'muted small' }, 'not posted yet'),
      r?.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, ' view') : null,
      m ? h('span', { class: 'small secondary' }, ` · ${compact.format(m.views ?? m.impressions ?? 0)} views · ${compact.format((m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0))} engagements`) : null,
      owner && !done && ['approved', 'scheduled', 'partial', 'failed'].includes(post.status)
        ? h('button', { type: 'button', class: 'small-btn', onclick: () => markPosted(v, post, id, close) }, 'Mark as posted')
        : null);
  });
  const copyText = () => navigator.clipboard?.writeText([post.title, post.text].filter(Boolean).join('\n\n')).then(() => v.toast('Text copied.'), () => v.toast('Copy failed; select the text instead.'));
  dialog.append(
    h('div', { class: 'post-detail' },
      h('div', { class: 'row-head' }, h('h2', {}, post.title || 'Post'), statusOf(v, post)),
      h('p', { class: 'small secondary' }, `${v.cityName(post.cityId)} · by ${authorOf(v, post)}${post.scheduledAt ? ` · ${when(post.scheduledAt)}` : ''}`),
      post.rejectReason && post.status === 'rejected' ? h('p', { class: 'small' }, `Rejected: ${post.rejectReason}`) : null,
      post.note ? h('p', { class: 'small' }, `Agent's note: ${post.note}`) : null,
      h('div', { class: 'media-row' }, post.media.map((m) => mediaThumb(m, { big: true }))),
      h('pre', { class: 'post-text' }, post.text || '(no text)'),
      post.firstComment ? h('p', { class: 'small' }, `First comment: ${post.firstComment}`) : null,
      h('h3', {}, 'Channels'),
      h('ul', { class: 'results' }, results),
      h('details', {}, h('summary', { class: 'small' }, 'History'), h('ul', { class: 'small' }, post.history.map((x) => h('li', {}, `${new Date(x.ts).toLocaleString()} · ${x.what}`)))),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'small-btn', onclick: copyText }, 'Copy text'),
        ['draft', 'pending', 'rejected'].includes(post.status) && act('Approve', run(v, () => send(v, 'intent.social_approve_post', post.cityId, { postId: post.id }).then(close), 'Approved.'), 'primary'),
        ['draft', 'pending', 'approved', 'scheduled'].includes(post.status) && act('Reject', () => rejectPost(v, post, close)),
        ['approved', 'scheduled'].includes(post.status) && act(post.scheduledAt ? 'Reschedule' : 'Schedule', () => schedulePost(v, post, close)),
        post.status === 'scheduled' && act('Unschedule', run(v, () => send(v, 'intent.social_schedule_post', post.cityId, { postId: post.id }).then(close), 'Unscheduled.')),
        !['published', 'partial'].includes(post.status) && act('Edit', () => { close(); compose(v, post); }),
        !['published', 'partial'].includes(post.status) && act('Delete', () => {
          close();
          confirmTwice(v, { what: 'post', name: (post.title || post.text).slice(0, 30).trim() || post.id, blocker: null, consequences: 'The post is removed from the plan. Its history stays in the ledger.', run: () => send(v, 'intent.social_delete_post', post.cityId, { postId: post.id }) });
        }, 'danger'),
        h('button', { type: 'button', class: 'small-btn', onclick: close }, 'Close'))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
function markPosted(v, post, channelId, done) {
  const ch = v.channel(channelId);
  openForm(v, {
    title: `Mark as posted on ${PLAT[ch.platform].label}`,
    intro: `For ${ch.handle}. Paste the link to the live post if you have it.`,
    fields: [{ name: 'url', label: 'Link to the post', type: 'text', placeholder: 'https://…' }],
    submitLabel: 'Mark as posted',
    onSubmit: async (val) => {
      if (val.url && !/^https?:\/\/\S+$/.test(val.url)) throw new Error('That is not a link.');
      await send(v, 'intent.social_mark_posted', post.cityId, { postId: post.id, channelId, ...(val.url ? { url: val.url } : {}) });
      done();
      return 'Marked as posted.';
    },
  });
}
function rejectPost(v, post, done) {
  openForm(v, {
    title: 'Reject post',
    intro: post.author.kind === 'agent' ? 'The agent sees your reason and can revise it.' : 'It goes back to draft.',
    fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
    submitLabel: 'Reject',
    onSubmit: async (val) => {
      await send(v, 'intent.social_reject_post', post.cityId, { postId: post.id, reason: val.reason });
      done();
      return 'Rejected.';
    },
  });
}
function schedulePost(v, post, done) {
  openForm(v, {
    title: post.scheduledAt ? 'Reschedule' : 'Schedule',
    fields: [{ name: 'at', label: 'Date and time', type: 'text', required: true, value: localInput(post.scheduledAt ?? new Date(Date.now() + 3600_000).toISOString()), help: 'Format: 2026-09-30T14:00 (your local time)' }],
    submitLabel: 'Schedule',
    onSubmit: async (val) => {
      const t = new Date(val.at);
      if (Number.isNaN(t.getTime())) throw new Error('Use a date and time like 2026-09-30T14:00.');
      await send(v, 'intent.social_schedule_post', post.cityId, { postId: post.id, scheduledAt: t.toISOString() });
      done();
      return `Scheduled for ${when(t.toISOString())}.`;
    },
  });
}

// ---------- calendar ----------
let calMonth = null; // Date for the first of the shown month
function calendarSection(v) {
  const now = new Date(v.serverNow());
  calMonth ??= new Date(now.getFullYear(), now.getMonth(), 1);
  const first = new Date(calMonth);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
  const byDay = new Map();
  const place = (post) => {
    const at = post.scheduledAt ?? Object.values(post.results).find((r) => r.status === 'published')?.at;
    if (!at) return false;
    const k = dayKey(new Date(at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push({ post, at });
    return true;
  };
  const unscheduled = v.posts.filter((p) => !place(p) && !['published', 'partial'].includes(p.status));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const chip = ({ post, at }, label = null) => {
    const movable = v.isOwner() && ['approved', 'scheduled'].includes(post.status);
    const plats = [...new Set(post.channelIds.map((id) => v.channel(id)?.platform).filter(Boolean))];
    const el = h('button', {
      type: 'button',
      class: `cal-chip st-${post.due ? 'due' : post.status}`,
      draggable: movable ? 'true' : null,
      title: `${post.text.slice(0, 120)}${movable ? ' · drag to another day to reschedule' : ''}`,
      onclick: () => postDetail(v, post),
    }, plats.map(platformBadge), h('span', { class: 'cal-time' }, label ?? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })), h('span', { class: 'cal-text' }, post.title || post.text || '(no text)'));
    if (movable) el.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text/plain', post.id));
    return el;
  };
  const cells = days.map((d) => {
    const k = dayKey(d);
    const items = (byDay.get(k) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    const cell = h('div', {
      class: `cal-day${d.getMonth() !== first.getMonth() ? ' other' : ''}${k === dayKey(now) ? ' today' : ''}`,
      'data-day': k,
    }, h('div', { class: 'cal-date' }, d.getDate()), items.map(chip));
    cell.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      cell.classList.add('drop');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
    cell.addEventListener('drop', (ev) => {
      ev.preventDefault();
      cell.classList.remove('drop');
      const post = v.posts.find((p) => p.id === ev.dataTransfer.getData('text/plain'));
      if (!post) return;
      // Keep the time of day, move the date.
      const old = post.scheduledAt ? new Date(post.scheduledAt) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), old.getHours(), old.getMinutes());
      run(v, () => send(v, 'intent.social_schedule_post', post.cityId, { postId: post.id, scheduledAt: next.toISOString() }), `Moved to ${when(next.toISOString())}.`)();
    });
    return cell;
  });
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const move = (n) => () => {
    calMonth = new Date(first.getFullYear(), first.getMonth() + n, 1);
    v.render();
  };
  return [
    h('div', { class: 'row-head' },
      h('h2', {}, monthName),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'small-btn', onclick: move(-1), 'aria-label': 'Previous month' }, '‹'),
        h('button', { type: 'button', class: 'small-btn', onclick: () => { calMonth = new Date(now.getFullYear(), now.getMonth(), 1); v.render(); } }, 'Today'),
        h('button', { type: 'button', class: 'small-btn', onclick: move(1), 'aria-label': 'Next month' }, '›'))),
    h('div', { class: 'cal', role: 'grid', 'aria-label': `Posts in ${monthName}` },
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('div', { class: 'cal-head' }, d)),
      cells),
    h('div', { class: 'card section' }, h('h3', {}, `Not scheduled (${unscheduled.length})`),
      unscheduled.length ? h('div', { class: 'unsched' }, unscheduled.map((post) => chip({ post, at: post.createdAt }, (STATUS[post.status] ?? [post.status])[0]))) : h('p', { class: 'muted small' }, 'Everything is scheduled.')),
  ];
}

// ---------- posts list ----------
let postFilter = 'all';
function postsSection(v) {
  const filters = [
    ['all', 'All', () => true],
    ['due', 'Due now', (p) => p.due],
    ['draft', 'Drafts', (p) => p.status === 'draft'],
    ['pending', 'Needs approval', (p) => p.status === 'pending'],
    ['scheduled', 'Scheduled', (p) => p.status === 'scheduled' && !p.due],
    ['published', 'Published', (p) => p.status === 'published' || p.status === 'partial'],
    ['problems', 'Failed or rejected', (p) => p.status === 'failed' || p.status === 'rejected'],
  ];
  const [, , test] = filters.find(([k]) => k === postFilter) ?? filters[0];
  const list = v.posts.filter(test);
  return [
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter posts' },
      filters.map(([k, label, t]) => h('button', { type: 'button', 'aria-pressed': String(k === postFilter), onclick: () => { postFilter = k; v.render(); } }, `${label} (${v.posts.filter(t).length})`))),
    v.table(['Post', 'Channels', 'Status', 'When', 'By', ''],
      list.map((p) => [
        h('div', { class: 'post-cell' }, p.media[0] ? mediaThumb(p.media[0]) : null, h('div', {}, p.title ? h('b', {}, p.title) : null, h('div', { class: 'small' }, clip(p.text, 90) || '(no text)'))),
        h('div', { class: 'chips' }, p.channelIds.map((id) => channelChip(v, id))),
        statusOf(v, p),
        p.scheduledAt ? when(p.scheduledAt) : h('span', { class: 'muted' }, '—'),
        authorOf(v, p),
        h('button', { type: 'button', class: 'small-btn', onclick: () => postDetail(v, p) }, 'Open'),
      ]),
      'No posts here yet.'),
  ];
}

// ---------- approvals ----------
function approvalsSection(v) {
  const pending = v.posts.filter((p) => p.status === 'pending');
  const drafts = v.posts.filter((p) => p.status === 'draft' || p.status === 'rejected');
  const card = (p) => h('div', { class: 'card appr' },
    h('div', { class: 'row-head' }, h('div', {}, p.title ? h('b', {}, p.title) : null, h('div', { class: 'small secondary' }, `By ${authorOf(v, p)} · ${v.cityName(p.cityId)} · ${v.ago(p.createdAt)}`)), statusOf(v, p)),
    h('div', { class: 'chips' }, p.channelIds.map((id) => channelChip(v, id))),
    p.media.length ? h('div', { class: 'media-row' }, p.media.map((m) => mediaThumb(m))) : null,
    h('p', {}, p.text || h('span', { class: 'muted' }, '(no text)')),
    p.note ? h('p', { class: 'small secondary' }, `Note: ${p.note}`) : null,
    v.isOwner() && h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'small-btn primary', onclick: run(v, () => send(v, 'intent.social_approve_post', p.cityId, { postId: p.id }), 'Approved.') }, 'Approve'),
      h('button', { type: 'button', class: 'small-btn', onclick: () => rejectPost(v, p, () => {}) }, 'Reject'),
      h('button', { type: 'button', class: 'small-btn', onclick: () => compose(v, p) }, 'Edit'),
      h('button', { type: 'button', class: 'small-btn', onclick: () => postDetail(v, p) }, 'Open')));
  return [
    h('p', { class: 'secondary' }, 'Agents draft posts through their Mayor; nothing is published until you approve it.'),
    h('h2', {}, `Needs your approval (${pending.length})`),
    pending.length ? h('div', { class: 'appr-list' }, pending.map(card)) : h('p', { class: 'muted small' }, 'Nothing waiting for approval.'),
    h('h2', {}, `Drafts and rejected (${drafts.length})`),
    drafts.length ? h('div', { class: 'appr-list' }, drafts.map(card)) : h('p', { class: 'muted small' }, 'No drafts.'),
  ];
}

// ---------- inbox ----------
const inboxState = { filter: 'open', selected: null };
function inboxSection(v) {
  const list = v.inbox.filter((i) => inboxState.filter === 'all' || (inboxState.filter === 'open' ? i.open : !i.open));
  const sel = v.inbox.find((i) => i.id === inboxState.selected) ?? list[0];
  const kindLabel = { comment: 'Comment', dm: 'Message', mention: 'Mention' };
  const rows = h('div', { class: 'inbox-list', role: 'list' },
    list.length
      ? list.map((i) => h('button', { type: 'button', role: 'listitem', class: `inbox-row${sel?.id === i.id ? ' sel' : ''}${i.open ? '' : ' closed'}`, onclick: () => { inboxState.selected = i.id; v.render(); } },
          h('div', { class: 'row-head' }, h('span', {}, channelChip(v, i.channelId)), h('span', { class: 'muted small' }, v.ago(i.receivedAt))),
          h('div', { class: 'small' }, h('b', {}, i.from), ` · ${kindLabel[i.kind]}`),
          h('div', { class: 'small secondary ellipsis' }, i.text)))
      : h('p', { class: 'muted small' }, 'Nothing here.'));
  let thread = h('div', { class: 'card inbox-thread' }, h('p', { class: 'muted' }, 'Pick a conversation.'));
  if (sel) {
    const city = v.cities.find((c) => c.id === sel.cityId);
    const agents = city ? city.districts.flatMap((d) => d.departments.flatMap((dp) => dp.agents)) : [];
    const reply = h('textarea', { rows: 3, placeholder: 'Write a reply…', 'aria-label': 'Reply' });
    const post = sel.postId ? v.posts.find((p) => p.id === sel.postId) : null;
    thread = h('div', { class: 'card inbox-thread' },
      h('div', { class: 'row-head' }, h('div', {}, h('b', {}, sel.from), h('span', { class: 'small secondary' }, ` · ${kindLabel[sel.kind]} on `), channelChip(v, sel.channelId)), h('span', { class: 'muted small' }, new Date(sel.receivedAt).toLocaleString())),
      post ? h('p', { class: 'small secondary' }, 'On your post: ', h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); postDetail(v, post); } }, post.title || clip(post.text, 60))) : null,
      h('div', { class: 'bubble them' }, sel.text),
      sel.replies.map((r) => h('div', { class: 'bubble you' }, r.text, h('div', { class: 'muted small' }, `${new Date(r.at).toLocaleString()} · saved; copy it to the platform until it's connected`))),
      v.isOwner() && [
        reply,
        h('div', { class: 'toolbar' },
          h('button', { type: 'button', class: 'small-btn primary', onclick: run(v, async () => {
            if (!reply.value.trim()) throw new Error('Write a reply first.');
            await send(v, 'intent.social_reply', sel.cityId, { itemId: sel.id, text: reply.value.trim() });
            navigator.clipboard?.writeText(reply.value.trim()).catch(() => {});
          }, 'Reply saved and copied: paste it on the platform.') }, 'Reply'),
          h('select', { 'aria-label': 'Assign to an agent', onchange: (ev) => run(v, () => send(v, 'intent.social_assign', sel.cityId, { itemId: sel.id, ...(ev.target.value ? { agentId: ev.target.value } : {}) }), 'Assigned.')() },
            h('option', { value: '' }, 'Unassigned'),
            agents.map((a) => h('option', { value: a.id, selected: sel.assignedTo === a.id }, `Assign to ${a.name}`))),
          h('button', { type: 'button', class: 'small-btn', onclick: run(v, () => send(v, 'intent.social_close', sel.cityId, { itemId: sel.id, ...(sel.open ? {} : { reopen: true }) }), sel.open ? 'Closed.' : 'Reopened.') }, sel.open ? 'Close' : 'Reopen')),
      ]);
  }
  return [
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Inbox filter' },
      [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(inboxState.filter === k), onclick: () => { inboxState.filter = k; inboxState.selected = null; v.render(); } }, label))),
    h('p', { class: 'small secondary' }, 'Comments, messages and mentions from every channel. New ones arrive once a platform is connected (or a bot reports them).'),
    h('div', { class: 'inbox' }, rows, thread),
  ];
}

// ---------- analytics ----------
let range = 30;
function analyticsSection(v) {
  const end = new Date(v.serverNow());
  const startOf = (days) => dayKey(new Date(end.getTime() - (days - 1) * 86_400_000));
  const from = startOf(range);
  const prevFrom = startOf(range * 2);
  const dates = Array.from({ length: range }, (_, i) => dayKey(new Date(end.getTime() - (range - 1 - i) * 86_400_000)));
  // Followers: carry each channel's last known count forward day by day, then sum.
  const followersOn = (ch, day) => {
    let last;
    for (const p of ch.series) {
      if (p.date > day) break;
      if (p.followers != null) last = p.followers;
    }
    return last;
  };
  const totalFollowers = dates.map((d) => ({ date: d, value: v.channels.reduce((n, ch) => n + (followersOn(ch, d) ?? 0), 0) }));
  const impressionsByDay = dates.map((d) => ({ date: d, value: v.channels.reduce((n, ch) => n + (ch.series.find((p) => p.date === d)?.impressions ?? 0), 0) }));
  const sumImpressions = (a, b) => v.channels.reduce((n, ch) => n + ch.series.filter((p) => p.date >= a && p.date <= b).reduce((m, p) => m + (p.impressions ?? 0), 0), 0);
  const published = v.posts.filter((p) => Object.values(p.results).some((r) => r.status === 'published' && dayKey(new Date(r.at)) >= from));
  const eng = (m) => (m ? (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0) : 0);
  const postRows = published.map((p) => {
    const ms = Object.values(p.metrics).filter(Boolean);
    const e = ms.reduce((n, m) => n + eng(m), 0);
    const reach = ms.reduce((n, m) => n + (m.views ?? m.impressions ?? m.reach ?? 0), 0);
    return { p, e, reach };
  }).sort((a, b) => b.e - a.e);
  const engagements = postRows.reduce((n, r) => n + r.e, 0);
  const postReach = postRows.reduce((n, r) => n + r.reach, 0);
  const fNow = totalFollowers.at(-1)?.value ?? 0;
  const dayBefore = dayKey(new Date(Date.parse(`${from}T12:00:00`) - 86_400_000));
  // Followers at the start of the range (or the earliest count we have), against now.
  const fThen = v.channels.reduce((n, ch) => n + (followersOn(ch, dayBefore) ?? ch.series.find((p) => p.followers != null)?.followers ?? 0), 0);
  const impr = sumImpressions(from, dayKey(end));
  const imprPrev = sumImpressions(prevFrom, dayBefore);
  const delta = (a, b) => (b ? `${a >= b ? '+' : ''}${pct.format((a - b) / b)} vs previous ${range} days` : 'no earlier data');

  const exportCsv = () => {
    const rows = [['date', 'brand', 'channel', 'platform', 'followers', 'impressions', 'reach']];
    for (const ch of v.channels) for (const p of ch.series) if (p.date >= from) rows.push([p.date, v.cityName(ch.cityId), ch.handle, ch.platform, p.followers ?? '', p.impressions ?? '', p.reach ?? '']);
    rows.push([]);
    rows.push(['post', 'brand', 'published', 'engagements', 'views']);
    for (const r of postRows) rows.push([(r.p.title || r.p.text).slice(0, 80).replaceAll('"', "'"), v.cityName(r.p.cityId), Object.values(r.p.results).find((x) => x.status === 'published')?.at ?? '', r.e, r.reach]);
    const csv = rows.map((r) => r.map((c) => `"${String(c)}"`).join(',')).join('\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `social-report-${dayKey(end)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
  };

  const channelRows = v.channels.map((ch) => {
    const now_ = followersOn(ch, dayKey(end)) ?? 0;
    const then = followersOn(ch, from) ?? now_;
    const imp = ch.series.filter((p) => p.date >= from).reduce((n, p) => n + (p.impressions ?? 0), 0);
    const posts = published.filter((p) => p.channelIds.includes(ch.id)).length;
    return [channelChip(v, ch.id), v.cityName(ch.cityId), whole.format(now_), `${now_ - then >= 0 ? '+' : ''}${whole.format(now_ - then)}`, compact.format(imp), whole.format(posts)];
  });

  return [
    h('div', { class: 'row-head' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' },
        [7, 30, 90].map((n) => h('button', { type: 'button', 'aria-pressed': String(range === n), onclick: () => { range = n; v.render(); } }, `${n} days`))),
      h('button', { type: 'button', class: 'small-btn', onclick: exportCsv }, 'Export report (CSV)')),
    h('div', { class: 'kpi-row' },
      v.stat('Followers', compact.format(fNow), fThen ? `${fNow >= fThen ? '+' : ''}${whole.format(fNow - fThen)} in ${range} days` : 'no earlier data'),
      v.stat('Impressions', compact.format(impr), delta(impr, imprPrev)),
      v.stat('Engagements', compact.format(engagements), `on ${published.length} post(s) published`),
      v.stat('Engagement rate', postReach ? pct.format(engagements / postReach) : '—', 'engagements ÷ views of those posts')),
    h('div', { class: 'two-col' },
      h('div', { class: 'card section' }, h('h3', {}, 'Followers, all channels'), lineChart(totalFollowers, (x) => whole.format(x)),
        h('details', {}, h('summary', { class: 'small' }, 'Table view'), v.table(['Date', { label: 'Followers', num: true }], totalFollowers.slice().reverse().map((p) => [p.date, whole.format(p.value)])))),
      h('div', { class: 'card section' }, h('h3', {}, 'Impressions per day'), barChart(impressionsByDay, (x) => whole.format(x)),
        h('details', {}, h('summary', { class: 'small' }, 'Table view'), v.table(['Date', { label: 'Impressions', num: true }], impressionsByDay.slice().reverse().map((p) => [p.date, whole.format(p.value)]))))),
    h('div', { class: 'card section' }, h('h3', {}, 'Channels'),
      v.table(['Channel', 'Brand', { label: 'Followers', num: true }, { label: `Change (${range}d)`, num: true }, { label: 'Impressions', num: true }, { label: 'Posts', num: true }], channelRows, 'No channels yet.')),
    h('div', { class: 'card section' }, h('h3', {}, 'Top posts'),
      v.table(['Post', 'Channels', { label: 'Engagements', num: true }, { label: 'Views', num: true }, ''],
        postRows.slice(0, 10).map((r) => [r.p.title || clip(r.p.text, 60), h('div', { class: 'chips' }, r.p.channelIds.map((id) => channelChip(v, id))), whole.format(r.e), compact.format(r.reach), h('button', { type: 'button', class: 'small-btn', onclick: () => postDetail(v, r.p) }, 'Open')]),
        'No published posts with metrics in this range yet.')),
  ];
}

/** Single-series line chart: 2px line, recessive grid, crosshair + tooltip on hover. */
function lineChart(points, fmt) {
  return plot(points, fmt, 'line');
}
/** Single-series bars: thin, rounded data end, 2px gaps, per-bar hover. */
function barChart(points, fmt) {
  return plot(points, fmt, 'bar');
}
function plot(points, fmt, kind) {
  const W = 560;
  const H = 180;
  const L = 44;
  const B = 22;
  const T = 10;
  const max = Math.max(1, ...points.map((p) => p.value));
  const min = kind === 'line' ? Math.min(...points.map((p) => p.value)) : 0;
  const lo = kind === 'line' ? Math.max(0, min - (max - min) * 0.1) : 0;
  const hi = max + (max - lo) * 0.05;
  const x = (i) => L + (i + 0.5) * ((W - L - 8) / points.length);
  const y = (val) => T + (H - T - B) * (1 - (val - lo) / (hi - lo || 1));
  const ticks = [lo, (lo + hi) / 2, hi];
  const wrap = h('div', { class: 'soc-plot' });
  const tip = h('div', { class: 'plot-tip', role: 'status' });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plot-svg', role: 'img', 'aria-label': `${points.length} days, latest ${fmt(points.at(-1)?.value ?? 0)}` },
    ticks.map((t) => [s('line', { x1: L, x2: W - 4, y1: y(t), y2: y(t), class: 'plot-grid' }), s('text', { x: L - 6, y: y(t) + 4, class: 'plot-tick', 'text-anchor': 'end' }, compact.format(t))]),
    [0, Math.floor(points.length / 2), points.length - 1].map((i) => points[i] && s('text', { x: x(i), y: H - 6, class: 'plot-tick', 'text-anchor': 'middle' }, points[i].date.slice(5))));
  if (kind === 'line') {
    svg.append(s('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(''), class: 'plot-line' }));
  } else {
    const bw = Math.max(2, (W - L - 8) / points.length - 2);
    for (const [i, p] of points.entries()) {
      const top = y(p.value);
      const bottom = y(0);
      const hgt = Math.max(0, bottom - top);
      const r = Math.min(4, bw / 2, hgt);
      svg.append(s('path', { class: 'plot-bar', d: `M${x(i) - bw / 2},${bottom}V${top + r}q0,-${r} ${r},-${r}h${bw - 2 * r}q${r},0 ${r},${r}V${bottom}Z` }));
    }
  }
  const cross = s('line', { class: 'plot-cross', y1: T, y2: H - B, x1: -10, x2: -10 });
  const dot = s('circle', { class: 'plot-dot', r: 4, cx: -10, cy: -10 });
  svg.append(cross, dot);
  svg.addEventListener('pointermove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round((px - L) / ((W - L - 8) / points.length) - 0.5)));
    const p = points[i];
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', y(p.value));
    tip.textContent = `${p.date}: ${fmt(p.value)}`;
    tip.style.left = `${(x(i) / W) * 100}%`;
    tip.classList.add('on');
    svg.classList.add('hover');
  });
  svg.addEventListener('pointerleave', () => {
    tip.classList.remove('on');
    svg.classList.remove('hover');
    cross.setAttribute('x1', -10);
    cross.setAttribute('x2', -10);
    dot.setAttribute('cx', -10);
  });
  wrap.append(svg, tip);
  return wrap;
}

// ---------- channels ----------
function channelsSection(v) {
  const addChannel = () => openForm(v, {
    title: 'Add a channel',
    intro: 'A social account one of your cities posts to. Real posting starts once its platform is connected; until then you post by hand from the plan.',
    fields: [
      { name: 'city', label: 'Brand (city)', type: 'select', required: true, options: v.cities.map((c) => [c.id, c.name]), value: v.brand || undefined },
      { name: 'platform', label: 'Platform', type: 'select', required: true, options: PLATFORMS.map((p) => [p, PLAT[p].label]) },
      { name: 'handle', label: 'Handle', type: 'text', required: true, placeholder: '@yourhandle' },
      { name: 'displayName', label: 'Display name', type: 'text', required: true },
    ],
    submitLabel: 'Add channel',
    onSubmit: async (val) => {
      await send(v, 'intent.social_add_channel', val.city, { platform: val.platform, handle: val.handle, displayName: val.displayName });
      return `${PLAT[val.platform].label} ${val.handle} added.`;
    },
  });
  const byCity = v.cities.filter((c) => !v.brand || c.id === v.brand);
  return [
    h('div', { class: 'row-head' }, h('p', { class: 'secondary' }, 'Each brand is one of your cities. Its agents draft for its channels; you approve.'), v.isOwner() && h('button', { type: 'button', class: 'small-btn primary', onclick: addChannel }, '+ Add channel')),
    byCity.map((c) => {
      const chans = v.channels.filter((ch) => ch.cityId === c.id);
      return h('div', { class: 'card section' },
        h('h3', {}, c.name),
        chans.length
          ? v.table(['Channel', 'Name', 'Posting', ''], chans.map((ch) => [
              channelChip(v, ch.id),
              ch.displayName,
              h('div', {}, v.statusChip('warning', 'Not connected: post by hand'), h('details', {}, h('summary', { class: 'small' }, 'To connect'), h('p', { class: 'small secondary' }, CONNECT_NEEDS[ch.platform]))),
              v.isOwner() && h('button', { type: 'button', class: 'small-btn danger', onclick: () => confirmTwice(v, { what: 'channel', name: ch.handle, blocker: null, consequences: `${PLAT[ch.platform].label} ${ch.handle} is removed from ${c.name}. Its posts and history stay in the ledger.`, run: () => send(v, 'intent.social_remove_channel', c.id, { channelId: ch.id }) }) }, 'Remove'),
            ]))
          : h('p', { class: 'muted small' }, 'No channels yet.'));
    }),
  ];
}
