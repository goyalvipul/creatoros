import { describe, expect, it } from 'vitest';
import { downloadAnchor } from './file-download';

describe('downloadAnchor', () => {
  it('saves in the current browser tab', () => {
    expect(downloadAnchor(false, 'clip.mp4')).toEqual({ download: 'clip.mp4' });
  });

  it('keeps an installed app on this page instead of opening a blank window', () => {
    expect(downloadAnchor(true, 'clip.mp4')).toEqual({ download: 'clip.mp4' });
    expect(downloadAnchor(true, 'clip.mp4')).not.toHaveProperty('target');
  });
});
