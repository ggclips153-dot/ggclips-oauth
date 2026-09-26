// The publisher: when an approved post's scheduled time comes, hand it to the platform's connector and record
// what happened (social.post_published / social.post_failed) as the DM. With no connector for a platform the
// post simply stays "due" and the dashboard shows it ready to post by hand. It never publishes anything Marc
// has not approved: the write-guard refuses that.
import type { Ledger } from '../ledger/ledger.ts';
import type { Profile } from '../ledger/guard.ts';
import type { Platform } from './model.ts';
import type { Channel, Post } from './state.ts';

export interface PublishResult {
  url?: string;
  externalId?: string;
}

/** A platform connection (Meta, TikTok, YouTube…). Added one by one as Marc provides each platform's keys. */
export interface Connector {
  platform: Platform;
  /** Is this channel connected (keys and account linked)? */
  connected(channel: Channel): boolean;
  publish(post: Post, channel: Channel, mediaPath: (ref: string) => string | null): Promise<PublishResult>;
}

const PUBLISHER: Profile = { id: 'publisher', role: 'dm', writeScope: ['*'] };

export function attachPublisher(ledger: Ledger, connectors: Connector[], { everyMs = 30_000, mediaPath = (_: string) => null as string | null, log = (m: string) => console.log(m) } = {}) {
  const byPlatform = new Map(connectors.map((c) => [c.platform, c]));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = ledger.clock().getTime();
      for (const post of ledger.state.social.posts.values()) {
        if (post.status !== 'scheduled' && post.status !== 'partial') continue;
        if (!post.scheduledAt || Date.parse(post.scheduledAt) > now) continue;
        for (const channelId of post.channelIds) {
          if (post.results[channelId]) continue; // published, or failed (retry is Marc's call)
          const channel = ledger.state.social.channels.get(channelId);
          const connector = channel && byPlatform.get(channel.platform);
          if (!channel || !connector || !connector.connected(channel)) continue; // stays due: post by hand
          try {
            const r = await connector.publish(post, channel, mediaPath);
            ledger.append(PUBLISHER, { type: 'social.post_published', city: post.cityId, payload: { postId: post.id, channelId, ...(r.url ? { url: r.url } : {}), ...(r.externalId ? { externalId: r.externalId } : {}) } });
          } catch (err) {
            ledger.append(PUBLISHER, { type: 'social.post_failed', city: post.cityId, payload: { postId: post.id, channelId, error: String((err as Error).message ?? err).slice(0, 1900) } });
          }
        }
      }
    } catch (err) {
      log(`publisher: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
