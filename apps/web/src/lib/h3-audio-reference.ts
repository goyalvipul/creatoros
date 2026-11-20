/** Audio state for an H3 timeline segment. Sharing copies media, never the per-segment lock. */
export type H3AudioReference = {
  audioFileId: string | null;
  audioUploadName: string | null;
  audioUploadWorkerId: string | null;
  audioName: string | null;
  audioTrim: boolean;
  audioStartSec: number;
  audioUseSec: number;
  audioSeconds: number | null;
  audioLocked: boolean;
};

export function h3AudioFields(clip: H3AudioReference) {
  return {
    audioFileId: clip.audioFileId,
    audioUploadName: clip.audioUploadName,
    audioUploadWorkerId: clip.audioUploadWorkerId,
    audioName: clip.audioName,
    audioTrim: clip.audioTrim,
    audioStartSec: clip.audioStartSec,
    audioUseSec: clip.audioUseSec,
    audioSeconds: clip.audioSeconds,
  };
}

/** Explicit share: copy the selected audio to every segment, preserving each lock. */
export function shareH3Audio<T extends H3AudioReference>(clips: T[], index: number): T[] {
  const source = clips[index];
  if (!source) return clips;
  return clips.map((clip) => ({ ...clip, ...h3AudioFields(source) }));
}

/** With sharing off only the chosen segment is cleared; with sharing on all are cleared. */
export function removeH3Audio<T extends H3AudioReference>(clips: T[], index: number, shared: boolean): T[] {
  if (!clips[index]) return clips;
  return clips.map((clip, i) =>
    shared || i === index
      ? {
          ...clip,
          audioFileId: null,
          audioUploadName: null,
          audioUploadWorkerId: null,
          audioName: null,
          audioTrim: false,
          audioStartSec: 0,
          audioUseSec: 0,
          audioSeconds: null,
          audioLocked: false,
        }
      : clip,
  );
}

/** Turn sharing off: retain audio only on the selected segment and remove duplicated copies. */
export function unshareH3Audio<T extends H3AudioReference>(clips: T[], index: number): T[] {
  if (!clips[index]) return clips;
  return clips.map((clip, i) =>
    i === index
      ? clip
      : {
          ...clip,
          audioFileId: null,
          audioUploadName: null,
          audioUploadWorkerId: null,
          audioName: null,
          audioTrim: false,
          audioStartSec: 0,
          audioUseSec: 0,
          audioSeconds: null,
          audioLocked: false,
        },
  );
}
