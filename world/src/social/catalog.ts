// Social events. Marc's requests (intent.social_*) are applied at once as DM and Mayor (A19). Agents draft
// through their city's Mayor bot (social.agent_drafted), which lands as "pending" for Marc's approval.
// Connectors and bots report what happened on the platforms as the DM: published, failed, inbox, metrics.
import type { Role } from '../domain/model.ts';
import type { EventSpec } from '../ledger/catalog.ts';
import type { Schema } from '../ledger/validate.ts';
import { INBOX_KINDS, PLATFORMS } from './model.ts';

const OWNER: readonly Role[] = ['owner'];
const MAYOR: readonly Role[] = ['mayor'];
const DM: readonly Role[] = ['dm'];

const id = { t: 'str', max: 20 } as const;
const postContent: Schema = {
  channelIds: { t: 'json', maxBytes: 2000 },
  text: { t: 'str', min: 0, max: 63206 },
  title: { t: 'str', max: 100, opt: true },
  media: { t: 'json', maxBytes: 8000, opt: true },
  firstComment: { t: 'str', max: 2200, opt: true },
};
const postEdit: Schema = {
  postId: id,
  channelIds: { t: 'json', maxBytes: 2000, opt: true },
  text: { t: 'str', min: 0, max: 63206, opt: true },
  title: { t: 'str', max: 100, opt: true },
  media: { t: 'json', maxBytes: 8000, opt: true },
  firstComment: { t: 'str', max: 2200, opt: true },
};
const channel: Schema = {
  platform: { t: 'str', oneOf: PLATFORMS },
  handle: { t: 'str', max: 120 },
  displayName: { t: 'str', max: 120 },
};
const metrics: Schema = {
  channelId: id,
  date: { t: 'date' },
  postId: { t: 'str', max: 20, opt: true },
  followers: { t: 'int', min: 0, opt: true },
  impressions: { t: 'int', min: 0, opt: true },
  reach: { t: 'int', min: 0, opt: true },
  views: { t: 'int', min: 0, opt: true },
  likes: { t: 'int', min: 0, opt: true },
  comments: { t: 'int', min: 0, opt: true },
  shares: { t: 'int', min: 0, opt: true },
  saves: { t: 'int', min: 0, opt: true },
};

const intent = (schema: Schema): EventSpec => ({ kind: 'intent', writers: OWNER, scope: 'city', schema });
const byMayor = (schema: Schema, authorizedBy: string, allocates?: EventSpec['allocates']): EventSpec => ({
  kind: 'fact',
  writers: MAYOR,
  scope: 'city',
  schema,
  authorizedBy: [authorizedBy],
  ...(allocates ? { allocates } : {}),
});

export const SOCIAL_CATALOG: Record<string, EventSpec> = {
  // ---- Marc's requests ----
  'intent.social_add_channel': intent(channel),
  'intent.social_remove_channel': intent({ channelId: id }),
  'intent.social_draft_post': intent({ ...postContent, scheduledAt: { t: 'datetime', opt: true }, approve: { t: 'bool', opt: true } }),
  'intent.social_edit_post': intent(postEdit),
  'intent.social_approve_post': intent({ postId: id }),
  'intent.social_reject_post': intent({ postId: id, reason: { t: 'str', max: 2000 } }),
  'intent.social_schedule_post': intent({ postId: id, scheduledAt: { t: 'datetime', opt: true } }),
  'intent.social_mark_posted': intent({ postId: id, channelId: id, url: { t: 'str', max: 500, opt: true } }),
  'intent.social_delete_post': intent({ postId: id }),
  'intent.social_reply': intent({ itemId: id, text: { t: 'str', max: 8000 } }),
  'intent.social_assign': intent({ itemId: id, agentId: { t: 'str', max: 20, opt: true } }),
  'intent.social_close': intent({ itemId: id, reopen: { t: 'bool', opt: true } }),

  // ---- The Mayor carries them out (and drafts for its agents) ----
  'social.channel_added': byMayor(channel, 'intent.social_add_channel', 'CHN'),
  'social.channel_removed': byMayor({ channelId: id }, 'intent.social_remove_channel'),
  'social.post_drafted': byMayor({ ...postContent, scheduledAt: { t: 'datetime', opt: true }, approve: { t: 'bool', opt: true } }, 'intent.social_draft_post', 'PST'),
  // An agent's draft, written by its Mayor bot: waits for Marc's approval. Never published without it.
  'social.agent_drafted': { kind: 'fact', writers: MAYOR, scope: 'city', schema: { ...postContent, authorAgentId: id, note: { t: 'str', max: 2000, opt: true } }, allocates: 'PST' },
  'social.post_edited': byMayor(postEdit, 'intent.social_edit_post'),
  'social.post_approved': byMayor({ postId: id }, 'intent.social_approve_post'),
  'social.post_rejected': byMayor({ postId: id, reason: { t: 'str', max: 2000 } }, 'intent.social_reject_post'),
  'social.post_scheduled': byMayor({ postId: id, scheduledAt: { t: 'datetime', opt: true } }, 'intent.social_schedule_post'),
  'social.post_deleted': byMayor({ postId: id }, 'intent.social_delete_post'),
  'social.inbox_replied': byMayor({ itemId: id, text: { t: 'str', max: 8000 } }, 'intent.social_reply'),
  'social.inbox_assigned': byMayor({ itemId: id, agentId: { t: 'str', max: 20, opt: true } }, 'intent.social_assign'),
  'social.inbox_closed': byMayor({ itemId: id, reopen: { t: 'bool', opt: true } }, 'intent.social_close'),

  // ---- What happened on the platforms, reported by connectors and bots (as the DM) ----
  'social.post_published': { kind: 'fact', writers: DM, scope: 'city', schema: { postId: id, channelId: id, url: { t: 'str', max: 500, opt: true }, externalId: { t: 'str', max: 200, opt: true }, manual: { t: 'bool', opt: true } } },
  'social.post_failed': { kind: 'fact', writers: DM, scope: 'city', schema: { postId: id, channelId: id, error: { t: 'str', max: 2000 } } },
  'social.inbox_received': {
    kind: 'fact',
    writers: DM,
    scope: 'city',
    schema: {
      channelId: id,
      kind: { t: 'str', oneOf: INBOX_KINDS },
      from: { t: 'str', max: 200 },
      text: { t: 'str', max: 8000 },
      postId: { t: 'str', max: 20, opt: true },
      externalId: { t: 'str', max: 200, opt: true },
    },
    allocates: 'MSG',
  },
  'social.metrics': { kind: 'fact', writers: DM, scope: 'city', schema: metrics },
};

export const isSocial = (type: string) => type.startsWith('social.') || type.startsWith('intent.social_');
