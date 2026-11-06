import { describe, expect, it } from 'vitest';
import { youtubeCommentIsLive } from './youtube-social';

describe('youtubeCommentIsLive', () => {
  it('keeps the first import historical', () => {
    expect(youtubeCommentIsLive('2026-11-01T00:00:00.000Z', null)).toBe(false);
    expect(youtubeCommentIsLive('2026-11-01T00:00:00.000Z', undefined)).toBe(false);
  });

  it('treats a comment newer than the last import as live', () => {
    expect(youtubeCommentIsLive('2026-11-05T12:00:00.000Z', '2026-11-05T11:00:00.000Z')).toBe(true);
    expect(youtubeCommentIsLive('2026-11-05T11:00:00.000Z', '2026-11-05T11:00:00.000Z')).toBe(false);
    expect(youtubeCommentIsLive('2026-11-05T10:00:00.000Z', '2026-11-05T11:00:00.000Z')).toBe(false);
  });
});
