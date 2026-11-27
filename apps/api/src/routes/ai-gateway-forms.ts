import { z } from 'zod';
const uuid = z.uuid();
export const ltxForm = z.object({
  projectId: uuid.nullable(),
  workerId: uuid.nullable(),
  imageFileId: uuid.nullable(),
  audioFileId: uuid.nullable(),
  audioStartSec: z.number().min(0).max(3600),
  durationSec: z.number().positive().max(120),
  prompt: z.string(),
  negativePrompt: z.string(),
  width: z.number().int().min(64).max(2048),
  height: z.number().int().min(64).max(2048),
  fps: z.number().int().min(1).max(60),
  loraName: z.string().min(1).max(180),
  loraStrength: z.number().min(0).max(2),
  upscaleWidth: z.number().int().min(64).max(4096),
  upscaleHeight: z.number().int().min(64).max(4096),
  upscaleResizeType: z.enum(['target dimensions', 'scale by multiplier']).optional().default('target dimensions'),
  upscaleQuality: z.enum(['LOW', 'MEDIUM', 'HIGH', 'ULTRA']).optional().default('ULTRA'),
  upscaleScale: z.number().min(1).max(4).optional().default(2),
  wantUpscale: z.boolean(),
  imageUploadName: z.string().max(300).nullable(),
  imageUploadWorkerId: uuid.nullable(),
  audioUploadName: z.string().max(300).nullable(),
  audioUploadWorkerId: uuid.nullable(),
});

export { h3Form } from '@creatoros/services';
