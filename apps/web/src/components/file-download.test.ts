import { describe, expect, it } from 'vitest';
import { downloadAnchor } from './file-download';

describe('downloadAnchor', () => {
  it('saves in the current browser tab', () => {
    expect(downloadAnchor(false, 'clip.mp4')).toEqual({ download: 'clip.mp4' });
  });

  it('opens the installed app download in the browser, not as a popup', () => {
    expect(downloadAnchor(true, 'clip.mp4')).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });
});
