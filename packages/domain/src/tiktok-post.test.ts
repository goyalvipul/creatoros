import { describe, expect, it } from 'vitest';
import { tiktokCaption, tiktokInteractionForm, tiktokInteractions, tiktokPostError } from './tiktok-post';

describe('tiktok post fields', () => {
  it('keeps the caption and hashtags under the TikTok limit and requires an audience', () => {
    expect(tiktokPostError({ caption: 'hello', hashtags: ['song'], privacy: null })).toMatch(/who can watch/);
    expect(tiktokCaption('hello', ['song'])).toBe('hello\n#song');
    expect(tiktokPostError({ caption: 'hello', hashtags: ['song'], privacy: 'SELF_ONLY' })).toBeNull();
    expect(tiktokPostError({ caption: 'x'.repeat(2201), privacy: 'SELF_ONLY' })).toMatch(/2200/);
  });

  it('treats a YouTube form value as all interactions on', () => {
    expect(tiktokInteractions('VIDEO')).toEqual({ comments: true, duet: true, stitch: true });
    expect(tiktokInteractions('comments,stitch')).toEqual({ comments: true, duet: false, stitch: true });
    expect(tiktokInteractionForm({ comments: false, duet: true, stitch: false })).toBe('duet');
  });
});
