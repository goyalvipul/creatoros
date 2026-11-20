/** Only the reference-video state, independent of the rest of an H3 segment. */
export type H3VideoReference = {
  videoFileId: string | null;
  videoUploadName: string | null;
  videoUploadWorkerId: string | null;
  videoName: string | null;
  videoTrim: boolean;
  videoStartSec: number;
  videoUseSec: number;
  videoSeconds: number | null;
};

/** Remove a reference from exactly one segment without changing its shot length or any other segment. */
export function removeH3ReferenceVideo<T extends H3VideoReference>(clips: T[], index: number): T[] {
  return clips.map((clip, i) =>
    i === index
      ? {
          ...clip,
          videoFileId: null,
          videoUploadName: null,
          videoUploadWorkerId: null,
          videoName: null,
          videoTrim: false,
          videoStartSec: 0,
          videoUseSec: 0,
          videoSeconds: null,
        }
      : clip,
  );
}
