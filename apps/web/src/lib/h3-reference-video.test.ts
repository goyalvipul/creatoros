import { describe, expect, it } from 'vitest';
import { removeH3ReferenceVideo } from './h3-reference-video';

const video = {
  videoFileId: 'file-one',
  videoUploadName: 'reference.mp4',
  videoUploadWorkerId: 'worker-1',
  videoName: 'reference.mp4',
  videoTrim: true,
  videoStartSec: 18,
  videoUseSec: 6,
  videoSeconds: 42,
  durationSec: '00:05:00',
  audioFileId: 'song',
};

describe('removeH3ReferenceVideo', () => {
  it('clears the selected segment and its stale trim metadata without altering shot or audio', () => {
    const second = { ...video, videoFileId: 'file-two' };
    const result = removeH3ReferenceVideo([video, second], 0);
    expect(result[0]).toEqual({
      ...video,
      videoFileId: null,
      videoUploadName: null,
      videoUploadWorkerId: null,
      videoName: null,
      videoTrim: false,
      videoStartSec: 0,
      videoUseSec: 0,
      videoSeconds: null,
    });
    expect(result[0]?.durationSec).toBe('00:05:00');
    expect(result[0]?.audioFileId).toBe('song');
    expect(result[1]).toBe(second);
  });

  it('leaves a shared video in other segments untouched', () => {
    const first = { ...video };
    const second = { ...video };
    const result = removeH3ReferenceVideo([first, second], 1);
    expect(result[0]).toBe(first);
    expect(result[1]?.videoFileId).toBeNull();
    expect(result[1]?.videoTrim).toBe(false);
  });

  it('does not mutate clips when the index is outside the timeline', () => {
    const result = removeH3ReferenceVideo([video], 3);
    expect(result).toEqual([video]);
    expect(result[0]).toBe(video);
  });
});
