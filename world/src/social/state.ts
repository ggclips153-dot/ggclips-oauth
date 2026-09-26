// Social state, rebuilt from the ledger: channels, posts (with their approval and publishing trail), the
// unified inbox, and metrics snapshots.
import type { LedgerEvent } from '../domain/state.ts';
import type { InboxKind, MediaItem, Platform, PostStatus } from './model.ts';

export interface Channel {
  id: string;
  cityId: string;
  platform: Platform;
  handle: string;
  displayName: string;
  addedAt: string;
  removed: boolean;
}

export interface PostResult {
  status: 'published' | 'failed';
  url: string | null;
  externalId: string | null;
  error: string | null;
  manual: boolean;
  at: string;
}

export interface Post {
  id: string;
  cityId: string;
  channelIds: string[];
  text: string;
  title: string | null;
  media: MediaItem[];
  firstComment: string | null;
  author: { kind: 'owner' | 'agent'; id: string };
  note: string | null;
  status: PostStatus;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectReason: string | null;
  results: Record<string, PostResult>;
  history: { seq: number; ts: string; what: string }[];
}

export interface InboxItem {
  id: string;
  cityId: string;
  channelId: string;
  kind: InboxKind;
  from: string;
  text: string;
  postId: string | null;
  externalId: string | null;
  receivedAt: string;
  open: boolean;
  assignedTo: string | null;
  replies: { text: string; at: string; seq: number }[];
}

export interface MetricPoint {
  date: string;
  followers?: number;
  impressions?: number;
  reach?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}

export class SocialState {
  readonly channels = new Map<string, Channel>();
  readonly posts = new Map<string, Post>();
  readonly inbox = new Map<string, InboxItem>();
  /** channelId -> date -> channel-level metrics (followers, impressions…). */
  readonly channelMetrics = new Map<string, Map<string, MetricPoint>>();
  /** postId|channelId -> latest metrics for that post on that channel. */
  readonly postMetrics = new Map<string, MetricPoint>();

  /** Is the post published everywhere, partly, or failed everywhere? */
  private settle(post: Post) {
    const results = post.channelIds.map((c) => post.results[c]).filter(Boolean);
    if (!results.length) return;
    const done = post.channelIds.filter((c) => post.results[c]?.status === 'published').length;
    if (done === post.channelIds.length) post.status = 'published';
    else if (done > 0) post.status = 'partial';
    else if (results.length === post.channelIds.length) post.status = 'failed';
  }

  apply(e: LedgerEvent): void {
    const p = e.payload as Record<string, any>;
    const post = p.postId ? this.posts.get(p.postId) : undefined;
    const item = p.itemId ? this.inbox.get(p.itemId) : undefined;
    const log = (what: string) => post?.history.push({ seq: e.seq, ts: e.ts, what });
    switch (e.type) {
      case 'social.channel_added':
        this.channels.set(e.subject!, { id: e.subject!, cityId: e.city, platform: p.platform, handle: p.handle, displayName: p.displayName, addedAt: e.ts, removed: false });
        break;
      case 'social.channel_removed': {
        const ch = this.channels.get(p.channelId);
        if (ch) ch.removed = true;
        break;
      }
      case 'social.post_drafted':
      case 'social.agent_drafted': {
        const byAgent = e.type === 'social.agent_drafted';
        const status: PostStatus = byAgent ? 'pending' : p.approve ? (p.scheduledAt ? 'scheduled' : 'approved') : 'draft';
        this.posts.set(e.subject!, {
          id: e.subject!,
          cityId: e.city,
          channelIds: p.channelIds,
          text: p.text,
          title: p.title ?? null,
          media: p.media ?? [],
          firstComment: p.firstComment ?? null,
          author: byAgent ? { kind: 'agent', id: p.authorAgentId } : { kind: 'owner', id: e.actor.replace(/-as-(dm|mayor)$/, '') },
          note: p.note ?? null,
          status,
          scheduledAt: p.scheduledAt ?? null,
          createdAt: e.ts,
          updatedAt: e.ts,
          approvedAt: status === 'approved' || status === 'scheduled' ? e.ts : null,
          rejectReason: null,
          results: {},
          history: [{ seq: e.seq, ts: e.ts, what: byAgent ? `drafted by agent ${p.authorAgentId}, waiting for approval` : status === 'draft' ? 'draft saved' : status === 'scheduled' ? `approved and scheduled for ${p.scheduledAt}` : 'approved' }],
        });
        break;
      }
      case 'social.post_edited':
        if (!post) break;
        for (const k of ['channelIds', 'text', 'title', 'media', 'firstComment'] as const) if (p[k] !== undefined) (post as any)[k] = p[k];
        if (post.status === 'rejected') post.status = 'draft';
        post.updatedAt = e.ts;
        log('edited');
        break;
      case 'social.post_approved':
        if (!post) break;
        post.status = post.scheduledAt ? 'scheduled' : 'approved';
        post.approvedAt = e.ts;
        post.rejectReason = null;
        post.updatedAt = e.ts;
        log('approved');
        break;
      case 'social.post_rejected':
        if (!post) break;
        post.status = 'rejected';
        post.rejectReason = p.reason;
        post.updatedAt = e.ts;
        log(`rejected: ${p.reason}`);
        break;
      case 'social.post_scheduled':
        if (!post) break;
        post.scheduledAt = p.scheduledAt ?? null;
        post.status = post.scheduledAt ? 'scheduled' : 'approved';
        post.updatedAt = e.ts;
        log(post.scheduledAt ? `scheduled for ${post.scheduledAt}` : 'unscheduled');
        break;
      case 'social.post_deleted':
        if (!post) break;
        post.status = 'deleted';
        post.updatedAt = e.ts;
        log('deleted');
        break;
      case 'social.post_published':
        if (!post) break;
        post.results[p.channelId] = { status: 'published', url: p.url ?? null, externalId: p.externalId ?? null, error: null, manual: !!p.manual, at: e.ts };
        this.settle(post);
        post.updatedAt = e.ts;
        log(`published on ${p.channelId}${p.manual ? ' (posted by hand)' : ''}`);
        break;
      case 'social.post_failed':
        if (!post) break;
        post.results[p.channelId] = { status: 'failed', url: null, externalId: null, error: p.error, manual: false, at: e.ts };
        this.settle(post);
        post.updatedAt = e.ts;
        log(`failed on ${p.channelId}: ${p.error}`);
        break;
      case 'social.inbox_received':
        this.inbox.set(e.subject!, {
          id: e.subject!,
          cityId: e.city,
          channelId: p.channelId,
          kind: p.kind,
          from: p.from,
          text: p.text,
          postId: p.postId ?? null,
          externalId: p.externalId ?? null,
          receivedAt: e.ts,
          open: true,
          assignedTo: null,
          replies: [],
        });
        break;
      case 'social.inbox_replied':
        if (!item) break;
        item.replies.push({ text: p.text, at: e.ts, seq: e.seq });
        break;
      case 'social.inbox_assigned':
        if (item) item.assignedTo = p.agentId ?? null;
        break;
      case 'social.inbox_closed':
        if (item) item.open = !!p.reopen;
        break;
      case 'social.metrics': {
        const point: MetricPoint = { date: p.date };
        for (const k of ['followers', 'impressions', 'reach', 'views', 'likes', 'comments', 'shares', 'saves'] as const) if (p[k] !== undefined) point[k] = p[k];
        if (p.postId) this.postMetrics.set(`${p.postId}|${p.channelId}`, point);
        else {
          if (!this.channelMetrics.has(p.channelId)) this.channelMetrics.set(p.channelId, new Map());
          this.channelMetrics.get(p.channelId)!.set(p.date, { ...this.channelMetrics.get(p.channelId)!.get(p.date), ...point });
        }
        break;
      }
    }
  }
}
