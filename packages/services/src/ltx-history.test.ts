import { describe, expect, it } from 'vitest';
import { originalAfterUpscaleFailure } from './ltx-history';

const clip = { node: '400', filename: 'Mehak_MusicVideo_Clip1_00001.mp4', subfolder: '', type: 'output' };
const upscale = { node: '610', filename: 'RTX_SR_00001.mp4', subfolder: 'Upscale', type: 'output' };

describe('originalAfterUpscaleFailure', () => {
  it('keeps the original clip when upscale produced no file', () => {
    expect(originalAfterUpscaleFailure({ status: 'error', outputs: [clip] })).toEqual([clip]);
  });

  it('leaves a finished upscale run alone', () => {
    expect(originalAfterUpscaleFailure({ status: 'success', outputs: [clip, upscale] })).toBeNull();
    expect(originalAfterUpscaleFailure({ status: 'error', outputs: [clip, upscale] })).toBeNull();
  });

  it('stays a failure when the original clip was never saved', () => {
    expect(originalAfterUpscaleFailure({ status: 'error', outputs: [] })).toBeNull();
  });
});
