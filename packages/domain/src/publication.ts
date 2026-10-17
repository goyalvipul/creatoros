import type { Platform, PublicationState, Provenance } from './enums';

export interface ParsedPostUrl {
  platform: Platform;
  externalId: string | null;
  canonicalUrl: string;
}

/** Recognise a pasted post URL. Never fetches anything; purely syntactic. */
export function parsePostUrl(raw: string): ParsedPostUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = u.searchParams.get('v');
    if (v)
      return { platform: 'youtube', externalId: v, canonicalUrl: `https://www.youtube.com/watch?v=${v}` };
    if (segs[0] === 'shorts' && segs[1])
      return {
        platform: 'youtube',
        externalId: segs[1],
        canonicalUrl: `https://www.youtube.com/shorts/${segs[1]}`,
      };
    return { platform: 'youtube', externalId: null, canonicalUrl: u.toString() };
  }
  if (host === 'youtu.be' && segs[0])
    return {
      platform: 'youtube',
      externalId: segs[0],
      canonicalUrl: `https://www.youtube.com/watch?v=${segs[0]}`,
    };
  if (host === 'instagram.com') {
    const idx = segs.findIndex((s) => ['reel', 'reels', 'p', 'tv'].includes(s));
    const id = idx >= 0 ? segs[idx + 1] : undefined;
    return {
      platform: 'instagram',
      externalId: id ?? null,
      canonicalUrl: id
        ? `https://www.instagram.com/${segs[idx] === 'p' ? 'p' : 'reel'}/${id}/`
        : u.toString(),
    };
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const vi = segs.indexOf('video');
    const id = vi >= 0 ? segs[vi + 1] : undefined;
    return { platform: 'tiktok', externalId: id ?? null, canonicalUrl: u.origin + u.pathname };
  }
  if (host === 'facebook.com' || host === 'fb.watch' || host === 'fb.com') {
    const id = u.searchParams.get('v') ?? (segs.includes('videos') ? segs[segs.indexOf('videos') + 1] : null);
    return { platform: 'facebook', externalId: id ?? null, canonicalUrl: u.toString() };
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const si = segs.indexOf('status');
    const id = si >= 0 ? segs[si + 1] : null;
    return { platform: 'x', externalId: id ?? null, canonicalUrl: `https://x.com${u.pathname}` };
  }
  if (host === 'snapchat.com')
    return { platform: 'snapchat', externalId: segs.at(-1) ?? null, canonicalUrl: u.toString() };
  if (host === 'threads.net')
    return { platform: 'threads', externalId: segs.at(-1) ?? null, canonicalUrl: u.toString() };
  if (host === 'linkedin.com') return { platform: 'linkedin', externalId: null, canonicalUrl: u.toString() };
  return { platform: 'other', externalId: null, canonicalUrl: u.toString() };
}

export const VERIFIED_STATES: readonly PublicationState[] = ['PUBLISHED_VERIFIED'];
export const PUBLISHED_STATES: readonly PublicationState[] = ['PUBLISHED_VERIFIED', 'PUBLISHED_MANUAL'];
export const OPEN_STATES: readonly PublicationState[] = [
  'NOT_PLANNED',
  'PLANNED',
  'READY',
  'SCHEDULED',
  'SUBMITTED',
  'PROCESSING',
  'FAILED',
  'UNKNOWN',
];

/** A state counts as "published with real evidence" only when verified by the platform. */
export function isVerifiedPublished(state: PublicationState): boolean {
  return state === 'PUBLISHED_VERIFIED';
}

export function isPublished(state: PublicationState): boolean {
  return state === 'PUBLISHED_VERIFIED' || state === 'PUBLISHED_MANUAL';
}

/** Which provenance a given way of setting a state may claim. Manual entry can never be VERIFIED. */
export function provenanceForSource(source: 'manual' | 'platform_api' | 'import'): Provenance {
  return source === 'platform_api' || source === 'import' ? 'VERIFIED_PLATFORM' : 'USER_ENTERED';
}

/** State a manual publish record is allowed to take. */
export function manualStateFor(requested: PublicationState): PublicationState {
  return requested === 'PUBLISHED_VERIFIED' ? 'PUBLISHED_MANUAL' : requested;
}

export interface CaptionValidation {
  warnings: string[];
  errors: string[];
}

const PLATFORM_LIMITS: Partial<Record<Platform, { title?: number; caption?: number; hashtags?: number }>> = {
  youtube: { title: 100, caption: 5000, hashtags: 15 },
  instagram: { caption: 2200, hashtags: 30 },
  tiktok: { caption: 2200, hashtags: 30 },
  x: { caption: 280 },
  facebook: { caption: 63206 },
  threads: { caption: 500 },
};

export function validatePublication(args: {
  platform: Platform;
  title?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  sponsored?: boolean;
  disclosure?: boolean;
}): CaptionValidation {
  const w: string[] = [];
  const e: string[] = [];
  const lim = PLATFORM_LIMITS[args.platform];
  if (lim?.title && args.title && args.title.length > lim.title)
    e.push(`Title exceeds ${lim.title} characters for ${args.platform}.`);
  if (lim?.caption && args.caption && args.caption.length > lim.caption)
    e.push(`Caption exceeds ${lim.caption} characters for ${args.platform}.`);
  if (lim?.hashtags && args.hashtags && args.hashtags.length > lim.hashtags)
    w.push(`More than ${lim.hashtags} hashtags may be ignored on ${args.platform}.`);
  if (!args.caption && !args.title) w.push('No title or caption yet.');
  if (args.sponsored && !args.disclosure)
    e.push('Sponsored/paid content needs a disclosure (e.g. #ad or the platform paid-partnership label).');
  return { warnings: w, errors: e };
}
