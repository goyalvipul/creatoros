const PLATFORM: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
};

/** "Instagram · @mehakviking", "Facebook · Mehak Thakur", "YouTube · <channel>" for accounts and conversation rows. */
export function accountLabel(x: {
  platform?: string;
  displayName?: string | null;
  accountName?: string | null;
  accountUsername?: string | null;
  username?: string | null;
  accountId?: string | null;
}): string {
  const name =
    x.displayName ??
    x.accountName ??
    ((x.accountUsername ?? x.username) ? `@${x.accountUsername ?? x.username}` : null) ??
    x.accountId ??
    'Account';
  const p = x.platform ? PLATFORM[x.platform] : null;
  return p ? `${p} · ${name}` : name;
}
