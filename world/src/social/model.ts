// Social: the channels each city (brand) posts to, and what each platform accepts.
// Posts are planned, approved by Marc and published through a platform connector when one is connected,
// or posted by hand and marked as posted. Nothing is ever published without Marc's approval (no auto-publish).

export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface PlatformRules {
  label: string;
  /** Longest caption / description the platform takes. */
  maxText: number;
  /** A post needs at least one photo or video. */
  needsMedia: boolean;
  /** Only video (TikTok, YouTube). */
  videoOnly: boolean;
  /** Needs a title (YouTube), up to this many characters. */
  titleMax: number | null;
  maxMedia: number;
}

export const PLATFORM_RULES: Record<Platform, PlatformRules> = {
  instagram: { label: 'Instagram', maxText: 2200, needsMedia: true, videoOnly: false, titleMax: null, maxMedia: 10 },
  facebook: { label: 'Facebook', maxText: 63206, needsMedia: false, videoOnly: false, titleMax: null, maxMedia: 10 },
  tiktok: { label: 'TikTok', maxText: 2200, needsMedia: true, videoOnly: true, titleMax: null, maxMedia: 1 },
  youtube: { label: 'YouTube', maxText: 5000, needsMedia: true, videoOnly: true, titleMax: 100, maxMedia: 1 },
};

export const INBOX_KINDS = ['comment', 'dm', 'mention'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export type PostStatus = 'draft' | 'pending' | 'approved' | 'scheduled' | 'published' | 'partial' | 'failed' | 'rejected' | 'deleted';

export interface MediaItem {
  /** An uploaded file ("media/<sha256>.<ext>") or a public https URL. */
  ref: string;
  kind: 'image' | 'video';
}

/** Problems that stop a post going out on a platform (checked when Marc approves or schedules it). */
export function platformProblems(platform: Platform, post: { text: string; title: string | null; media: MediaItem[] }): string[] {
  const r = PLATFORM_RULES[platform];
  const out: string[] = [];
  if (post.text.length > r.maxText) out.push(`${r.label}: text is ${post.text.length} characters (max ${r.maxText})`);
  if (r.needsMedia && !post.media.length) out.push(`${r.label}: needs ${r.videoOnly ? 'a video' : 'a photo or video'}`);
  if (r.videoOnly && post.media.some((m) => m.kind !== 'video')) out.push(`${r.label}: video only`);
  if (post.media.length > r.maxMedia) out.push(`${r.label}: at most ${r.maxMedia} file(s)`);
  if (r.titleMax !== null && !post.title) out.push(`${r.label}: needs a title`);
  if (r.titleMax !== null && post.title && post.title.length > r.titleMax) out.push(`${r.label}: title is ${post.title.length} characters (max ${r.titleMax})`);
  return out;
}
