import { describe, expect, it } from 'vitest';
import { clipBounds, clipPlayback } from './audio-clip';

describe('LTX audio clip', () => {
  it('uses the start and the length, not the whole file', () => {
    expect(clipBounds(28, 30)).toEqual({ start: 28, end: 58 });
    expect(clipPlayback(0, 28, 58, 180)).toBe('seek');
    expect(clipPlayback(0, 28, 58, 2)).toBe('wait');
    expect(clipPlayback(40, 28, 58, 180)).toBe('ok');
    expect(clipPlayback(58, 28, 58, 180)).toBe('restart');
  });
});
