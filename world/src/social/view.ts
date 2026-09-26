// What the dashboard's Social tab gets: channels, posts, inbox and metrics for the cities the viewer may see.
import type { WorldState } from '../domain/state.ts';
import { PLATFORM_RULES } from './model.ts';

export function socialView(state: WorldState, scope: '*' | string, now: Date) {
  const s = state.social;
  const inScope = (city: string) => scope === '*' || city === scope;
  const channels = [...s.channels.values()]
    .filter((c) => !c.removed && inScope(c.cityId))
    .map((c) => {
      const series = [...(s.channelMetrics.get(c.id)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
      return { ...c, series };
    });
  const posts = [...s.posts.values()]
    .filter((p) => p.status !== 'deleted' && inScope(p.cityId))
    .map((p) => ({
      ...p,
      // Scheduled time has come and no connector has published it: waiting to be posted (by hand until connected).
      due: p.status === 'scheduled' && !!p.scheduledAt && Date.parse(p.scheduledAt) <= now.getTime(),
      metrics: Object.fromEntries(p.channelIds.map((c) => [c, s.postMetrics.get(`${p.id}|${c}`) ?? null])),
    }))
    .sort((a, b) => (b.scheduledAt ?? b.createdAt).localeCompare(a.scheduledAt ?? a.createdAt));
  const inbox = [...s.inbox.values()].filter((i) => inScope(i.cityId)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return { platforms: PLATFORM_RULES, channels, posts, inbox };
}
