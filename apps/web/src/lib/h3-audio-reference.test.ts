import { describe, expect, it } from 'vitest';
import { h3AudioFields, removeH3Audio, shareH3Audio } from './h3-audio-reference';

const first = {
  audioFileId: 'song-one',
  audioUploadName: null,
  audioUploadWorkerId: null,
  audioName: 'first.wav',
  audioTrim: true,
  audioStartSec: 12,
  audioUseSec: 8,
  audioSeconds: 180,
  audioLocked: true,
  durationSec: '00:08:00',
  videoName: 'dance.mp4',
};
const second = { ...first, audioFileId: 'song-two', audioName: 'second.wav', audioTrim: false, audioLocked: false, durationSec: '00:06:00' };

describe('H3 audio per-segment operations', () => {
  it('does not propagate audio without an explicit share action', () => {
    const before = [first, second];
    const changed = before.map((clip, i) => i === 0 ? { ...clip, audioName: 'new.wav' } : clip);
    expect(changed[1]).toBe(second);
    expect(changed[1]?.audioName).toBe('second.wav');
  });

  it('shares the selected reference and trim only after share is clicked, without sharing locks', () => {
    const result = shareH3Audio([first, second], 0);
    expect(h3AudioFields(result[1]!)).toEqual(h3AudioFields(first));
    expect(result[1]?.audioLocked).toBe(false);
    expect(result[1]?.durationSec).toBe('00:06:00');
  });

  it('removes only the selected segment when sharing is disabled', () => {
    const result = removeH3Audio([first, second], 0, false);
    expect(result[0]).toMatchObject({ audioFileId: null, audioName: null, audioTrim: false, audioStartSec: 0, audioUseSec: 0, audioLocked: false });
    expect(result[0]?.durationSec).toBe('00:08:00');
    expect(result[0]?.videoName).toBe('dance.mp4');
    expect(result[1]).toBe(second);
  });

  it('removes every audio reference when sharing is enabled and a tile is cleared', () => {
    const result = removeH3Audio(shareH3Audio([first, second], 0), 0, true);
    expect(result).toHaveLength(2);
    expect(result.every(clip => clip.audioFileId === null && clip.audioName === null && !clip.audioLocked)).toBe(true);
  });

  it('preserves state on out-of-range operations', () => {
    expect(removeH3Audio([first, second], 4, true)[0]).toBe(first);
    expect(shareH3Audio([first, second], -1)[1]).toBe(second);
  });
});
