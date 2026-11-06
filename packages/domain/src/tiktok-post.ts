export const TIKTOK_PRIVACY = [
  { id: 'PUBLIC_TO_EVERYONE', label: 'Everyone' },
  { id: 'MUTUAL_FOLLOW_FRIENDS', label: 'Friends' },
  { id: 'FOLLOWER_OF_CREATOR', label: 'Followers' },
  { id: 'SELF_ONLY', label: 'Only me' },
] as const;

const LEVELS = new Set<string>(TIKTOK_PRIVACY.map((row) => row.id));

export function tiktokPrivacy(value: string | null | undefined): string | null {
  return value && LEVELS.has(value) ? value : null;
}

export function tiktokCaption(caption: string | null | undefined, hashtags: string[]): string {
  const tags = hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).filter((tag) => tag !== '#');
  return [caption?.trim(), tags.join(' ')].filter(Boolean).join('\n');
}

export function tiktokPostError(input: { caption?: string | null; hashtags?: string[]; privacy?: string | null }): string | null {
  if (!tiktokPrivacy(input.privacy)) return 'Choose who can watch this TikTok.';
  if (tiktokCaption(input.caption, input.hashtags ?? []).length > 2200)
    return 'A TikTok caption can be at most 2200 characters, including hashtags.';
  return null;
}

/** A blank or YouTube form means comments, duet, and stitch stay on until the owner turns one off. */
export function tiktokInteractions(contentForm: string | null | undefined): { comments: boolean; duet: boolean; stitch: boolean } {
  const raw = (contentForm ?? '').trim();
  if (!raw || raw === 'VIDEO' || raw === 'SHORT') return { comments: true, duet: true, stitch: true };
  return { comments: raw.includes('comments'), duet: raw.includes('duet'), stitch: raw.includes('stitch') };
}

export function tiktokInteractionForm(flags: { comments: boolean; duet: boolean; stitch: boolean }): string {
  return [flags.comments && 'comments', flags.duet && 'duet', flags.stitch && 'stitch'].filter(Boolean).join(',');
}
