export const UPSCALE_FAILED = 'Upscaling Failed';

export type SavedVideo = { node: string; filename: string; subfolder: string; type: string };

/** Node 610 saves the RTX upscale. Node 400 saves the clip before that step. */
export function isUpscaleVideo(video: { node: string; filename: string }) {
  return video.node === '610' || /(?:^|\/)upscale\/|rtx_sr/i.test(video.filename);
}

/**
 * The run stopped after the original clip was saved and before an upscale file existed.
 * That clip is the result. A run with no original clip stays a failure.
 */
export function originalAfterUpscaleFailure(input: { status?: string; outputs: SavedVideo[] }): SavedVideo[] | null {
  if (input.status !== 'error') return null;
  if (input.outputs.some(isUpscaleVideo)) return null;
  const original = input.outputs.filter((video) => video.node === '400');
  return original.length ? original : null;
}
