// Write rules for social events, checked by the ledger's write-guard before anything is appended.
// The one rule that matters most: nothing is published unless Marc approved it (no auto-publish).
import { isJailed, type LedgerEvent, type WorldState } from '../domain/state.ts';
import { conflict, forbid, invalid, notFound } from '../ledger/errors.ts';
import { PLATFORM_RULES, platformProblems, type MediaItem } from './model.ts';
import type { Post } from './state.ts';

interface Draft {
  type: string;
  city: string;
  payload: Record<string, unknown>;
}

const MEDIA_REF = /^(media\/[0-9a-f]{64}\.[a-z0-9]{2,5}|https:\/\/\S{1,480})$/;
const GRADUATED = ['probationer', 'active', 'senior'];

export function checkSocial(state: WorldState, d: Draft, intent: LedgerEvent | undefined, now: Date, match: (keys: string[]) => void) {
  const s = state.social;
  const p = d.payload as Record<string, any>;

  const channelIn = (id: unknown) => {
    const ch = s.channels.get(String(id)) ?? notFound(`unknown channel: ${id}`);
    if (ch.cityId !== d.city) forbid(`channel ${ch.id} belongs to ${ch.cityId}, not ${d.city}`);
    if (ch.removed) conflict(`channel ${ch.id} was removed`);
    return ch;
  };
  const postIn = (id: unknown) => {
    const post = s.posts.get(String(id)) ?? notFound(`unknown post: ${id}`);
    if (post.cityId !== d.city) forbid(`post ${post.id} belongs to ${post.cityId}, not ${d.city}`);
    if (post.status === 'deleted') conflict(`post ${post.id} was deleted`);
    return post;
  };
  const itemIn = (id: unknown) => {
    const item = s.inbox.get(String(id)) ?? notFound(`unknown inbox item: ${id}`);
    if (item.cityId !== d.city) forbid(`inbox item ${item.id} belongs to ${item.cityId}, not ${d.city}`);
    return item;
  };
  const channelList = (v: unknown) => {
    if (!Array.isArray(v) || !v.length || v.length > 20 || v.some((x) => typeof x !== 'string')) invalid('channelIds must be a list of 1 to 20 channel IDs');
    const ids = [...new Set(v as string[])];
    for (const c of ids) channelIn(c);
    return ids;
  };
  const mediaList = (v: unknown): MediaItem[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 10) invalid('media must be a list of up to 10 files');
    for (const m of v as any[]) {
      if (!m || typeof m !== 'object' || typeof m.ref !== 'string' || !MEDIA_REF.test(m.ref) || !['image', 'video'].includes(m.kind) || Object.keys(m).some((k) => k !== 'ref' && k !== 'kind')) {
        invalid('each media item is { ref: an uploaded file or https URL, kind: "image" | "video" }');
      }
    }
    return v as MediaItem[];
  };
  /** Every channel's platform must accept the post as it stands (checked on approval and scheduling). */
  const ready = (post: Pick<Post, 'channelIds' | 'text' | 'title' | 'media'>) => {
    const problems = post.channelIds.flatMap((c) => platformProblems(channelIn(c).platform, post));
    if (problems.length) conflict(`not ready to publish: ${problems.join('; ')}`);
  };
  const future = (at: string | undefined) => {
    if (at && Date.parse(at) < now.getTime() - 60_000) invalid('the scheduled time is in the past');
  };
  const canPublish = (post: Post, channelId: string) => {
    if (!post.channelIds.includes(channelId)) forbid(`post ${post.id} is not for channel ${channelId}`);
    // No auto-publish: only a post Marc approved can go out.
    if (!['approved', 'scheduled', 'partial', 'failed'].includes(post.status)) forbid(`post ${post.id} is ${post.status}; only a post Marc approved can be published`);
    if (post.results[channelId]?.status === 'published') conflict(`post ${post.id} is already published on ${channelId}`);
  };

  switch (d.type) {
    case 'intent.social_add_channel':
    case 'social.channel_added': {
      if (d.type === 'social.channel_added') match(['platform', 'handle', 'displayName']);
      const handle = String(p.handle).toLowerCase();
      const dup = [...s.channels.values()].find((c) => !c.removed && c.cityId === d.city && c.platform === p.platform && c.handle.toLowerCase() === handle);
      if (dup) conflict(`${PLATFORM_RULES[dup.platform].label} ${dup.handle} is already a channel of this city (${dup.id})`);
      break;
    }
    case 'intent.social_remove_channel':
    case 'social.channel_removed':
      if (d.type === 'social.channel_removed') match(['channelId']);
      channelIn(p.channelId);
      break;

    case 'intent.social_draft_post':
    case 'social.post_drafted': {
      if (d.type === 'social.post_drafted') match(['channelIds', 'text', 'title', 'media', 'firstComment', 'scheduledAt', 'approve']);
      const channelIds = channelList(p.channelIds);
      const media = mediaList(p.media);
      if (p.scheduledAt && !p.approve) invalid('a post can only be scheduled once it is approved');
      future(p.scheduledAt);
      if (p.approve) ready({ channelIds, text: p.text, title: p.title ?? null, media });
      break;
    }
    case 'social.agent_drafted': {
      const a = state.agents.get(String(p.authorAgentId)) ?? notFound(`unknown agent: ${p.authorAgentId}`);
      if (a.cityId !== d.city || a.deleted || a.role !== 'agent') forbid(`agent ${a.id} is not a working agent of ${d.city}`);
      if (!GRADUATED.includes(a.state)) forbid(`agent ${a.id} is ${a.state}; only graduated agents draft posts`);
      if (isJailed(a, now)) conflict(`agent ${a.id} is in jail`);
      channelList(p.channelIds);
      mediaList(p.media);
      break;
    }
    case 'intent.social_edit_post':
    case 'social.post_edited': {
      if (d.type === 'social.post_edited') match(['postId', 'channelIds', 'text', 'title', 'media', 'firstComment']);
      const post = postIn(p.postId);
      if (['published', 'partial'].includes(post.status)) conflict(`post ${post.id} is already published`);
      const next = {
        channelIds: p.channelIds !== undefined ? channelList(p.channelIds) : post.channelIds,
        text: p.text ?? post.text,
        title: p.title ?? post.title,
        media: p.media !== undefined ? mediaList(p.media) : post.media,
      };
      // An approved post stays publishable after the edit.
      if (['approved', 'scheduled'].includes(post.status)) ready(next);
      break;
    }
    case 'intent.social_approve_post':
    case 'social.post_approved': {
      if (d.type === 'social.post_approved') match(['postId']);
      const post = postIn(p.postId);
      if (!['draft', 'pending', 'rejected'].includes(post.status)) conflict(`post ${post.id} is already ${post.status}`);
      ready(post);
      break;
    }
    case 'intent.social_reject_post':
    case 'social.post_rejected': {
      if (d.type === 'social.post_rejected') match(['postId', 'reason']);
      const post = postIn(p.postId);
      if (!['draft', 'pending', 'approved', 'scheduled'].includes(post.status)) conflict(`post ${post.id} is ${post.status}`);
      break;
    }
    case 'intent.social_schedule_post':
    case 'social.post_scheduled': {
      if (d.type === 'social.post_scheduled') match(['postId', 'scheduledAt']);
      const post = postIn(p.postId);
      if (!['approved', 'scheduled'].includes(post.status)) conflict(`post ${post.id} is ${post.status}; approve it before scheduling`);
      future(p.scheduledAt);
      break;
    }
    case 'intent.social_delete_post':
    case 'social.post_deleted': {
      if (d.type === 'social.post_deleted') match(['postId']);
      const post = postIn(p.postId);
      if (['published', 'partial'].includes(post.status)) conflict(`post ${post.id} is published; remove it on the platform itself`);
      break;
    }
    case 'intent.social_mark_posted': {
      const post = postIn(p.postId);
      channelIn(p.channelId);
      canPublish(post, String(p.channelId));
      break;
    }
    case 'social.post_published':
    case 'social.post_failed': {
      const post = postIn(p.postId);
      channelIn(p.channelId);
      canPublish(post, String(p.channelId));
      break;
    }
    case 'intent.social_reply':
    case 'social.inbox_replied':
      if (d.type === 'social.inbox_replied') match(['itemId', 'text']);
      itemIn(p.itemId);
      break;
    case 'intent.social_assign':
    case 'social.inbox_assigned': {
      if (d.type === 'social.inbox_assigned') match(['itemId', 'agentId']);
      itemIn(p.itemId);
      if (p.agentId) {
        const a = state.agents.get(String(p.agentId)) ?? notFound(`unknown agent: ${p.agentId}`);
        if (a.cityId !== d.city || a.deleted) forbid(`agent ${a.id} is not in ${d.city}`);
      }
      break;
    }
    case 'intent.social_close':
    case 'social.inbox_closed':
      if (d.type === 'social.inbox_closed') match(['itemId', 'reopen']);
      itemIn(p.itemId);
      break;
    case 'social.inbox_received':
      channelIn(p.channelId);
      if (p.postId) postIn(p.postId);
      break;
    case 'social.metrics':
      channelIn(p.channelId);
      if (p.postId) postIn(p.postId);
      break;
  }
  void intent;
}
