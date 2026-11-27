import { z } from 'zod';
const uuid = z.uuid();
const h3Image = z.object({
    fileId: uuid.nullable(),
    uploadName: z.string().max(300).nullable(),
    uploadWorkerId: uuid.nullable(),
    shared: z.boolean(),
  });
  const h3Segment = z.object({
    continuity: z.enum(['shot', 'context', 'context_swap']),
    taskMode: z.enum(['i2v', 'ref', 'v2v', 'l2v']),
    refImageSize: z.enum(['max', 'match']).default('max'),
    prompt: z.string(),
    audioFileId: uuid.nullable(),
    audioUploadName: z.string().max(300).nullable(),
    audioUploadWorkerId: uuid.nullable(),
    audioLocked: z.boolean().optional(),
    audioTrim: z.boolean().optional().default(false),
    audioStartSec: z.number().min(0).max(3600).nullable().optional(),
    audioUseSec: z.number().positive().max(30).nullable().optional(),
    videoFileId: uuid.nullable().optional().default(null),
    videoUploadName: z.string().max(300).nullable().optional().default(null),
    videoUploadWorkerId: uuid.nullable().optional().default(null),
    videoTrim: z.boolean().optional().default(false),
    videoStartSec: z.number().min(0).max(3600).nullable().optional(),
    videoUseSec: z.number().positive().max(30).nullable().optional(),
    durationSec: z.number().positive().max(30).nullable(),
    images: z.array(h3Image).max(8),
  });
  export const h3Form = z.object({
    projectId: uuid.nullable(),
    workerId: uuid.nullable(),
    imageFileId: uuid.nullable(),
    imageUploadName: z.string().max(300).nullable(),
    imageUploadWorkerId: uuid.nullable(),
    prompt: z.string(),
    aspectRatio: z.string().min(1).max(80),
    megapixels: z.union([z.literal(0.5), z.literal(1), z.literal(1.5)]),
    audioLocked: z.boolean(),
    shareAudio: z.boolean(),
    videoLocked: z.boolean().optional().default(true),
    shareVideo: z.boolean().optional().default(false),
    segments: z.array(h3Segment).max(8),
  });
