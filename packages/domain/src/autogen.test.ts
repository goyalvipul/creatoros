import { describe, expect, it } from 'vitest';
import { autogenClipSeconds, parseAutogenTimestamps } from './autogen';

describe('autogen timestamps', () => {
  it('reads seconds and clock times, and keeps the earliest unique starts', () => {
    expect(parseAutogenTimestamps('30, 0, 1:15, 30')).toEqual([0, 30, 75]);
  });

  it('gives the 3060 twenty seconds and the 3090 thirty, and shortens the last clip', () => {
    expect(autogenClipSeconds({ expectedVramGb: 12, label: 'RTX 3060' }, 0, 180)).toBe(20);
    expect(autogenClipSeconds({ expectedVramGb: 24, label: 'RTX 3090' }, 0, 180)).toBe(30);
    expect(autogenClipSeconds({ expectedVramGb: 24, label: 'RTX 3090' }, 170, 180)).toBe(10);
    expect(autogenClipSeconds({ expectedVramGb: 12, label: 'RTX 3060' }, 179.5, 180)).toBeNull();
  });
});
