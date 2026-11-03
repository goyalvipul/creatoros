import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { orgRef, users } from './identity';
import { creativeProjects } from './production';
import { devices, fileInstances } from './storage';

/** A ComfyUI the owner can send work to. The address stays on the server. */
export const gpuWorkers = pgTable(
  'gpu_workers',
  {
    id: pk(),
    orgId: orgRef(),
    label: text('label').notNull(),
    baseUrl: text('base_url').notNull(),
    role: text('role').notNull().default('secondary'),
    enabled: boolean('enabled').notNull().default(true),
    expectedVramGb: integer('expected_vram_gb'),
    lastCheckedAt: ts('last_checked_at'),
    lastOk: boolean('last_ok'),
    lastError: text('last_error'),
    reportedVramGb: doublePrecision('reported_vram_gb'),
    comfyVersion: text('comfy_version'),
    deviceName: text('device_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('gpu_workers_org_url_uq').on(t.orgId, t.baseUrl), index('gpu_workers_org_idx').on(t.orgId)],
);

/** The one LTX form the owner is filling in. Saving it does not start a render. */
export const ltxDrafts = pgTable(
  'ltx_drafts',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id').references(() => creativeProjects.id, { onDelete: 'set null' }),
    workerId: uuid('worker_id').references(() => gpuWorkers.id, { onDelete: 'set null' }),
    imageFileId: uuid('image_file_id').references(() => fileInstances.id, { onDelete: 'set null' }),
    audioFileId: uuid('audio_file_id').references(() => fileInstances.id, { onDelete: 'set null' }),
    audioStartSec: doublePrecision('audio_start_sec').notNull().default(0),
    durationSec: doublePrecision('duration_sec').notNull().default(20),
    prompt: text('prompt').notNull().default(''),
    negativePrompt: text('negative_prompt').notNull().default(''),
    width: integer('width').notNull().default(576),
    height: integer('height').notNull().default(1024),
    fps: integer('fps').notNull().default(30),
    loraName: text('lora_name').notNull().default('mehaklora-ltx.safetensors'),
    loraStrength: doublePrecision('lora_strength').notNull().default(0.8),
    upscaleWidth: integer('upscale_width').notNull().default(1152),
    upscaleHeight: integer('upscale_height').notNull().default(2048),
    wantUpscale: boolean('want_upscale').notNull().default(true),
    imageUploadName: text('image_upload_name'),
    imageUploadWorkerId: uuid('image_upload_worker_id').references(() => gpuWorkers.id, { onDelete: 'set null' }),
    audioUploadName: text('audio_upload_name'),
    audioUploadWorkerId: uuid('audio_upload_worker_id').references(() => gpuWorkers.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ltx_drafts_org_uq').on(t.orgId)],
);

/** The voice-clone form. Saving it does not start a job. */
export const qwenDrafts = pgTable(
  'qwen_drafts',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id').references(() => creativeProjects.id, { onDelete: 'set null' }),
    workerId: uuid('worker_id').references(() => gpuWorkers.id, { onDelete: 'set null' }),
    audioFileId: uuid('audio_file_id').references(() => fileInstances.id, { onDelete: 'set null' }),
    audioUploadName: text('audio_upload_name'),
    audioUploadWorkerId: uuid('audio_upload_worker_id').references(() => gpuWorkers.id, { onDelete: 'set null' }),
    useBuiltin: boolean('use_builtin').notNull().default(true),
    builtinClip: text('builtin_clip').notNull().default('mehakdeepvoice.wav'),
    referenceText: text('reference_text').notNull().default(''),
    targetText: text('target_text').notNull().default(''),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('qwen_drafts_org_uq').on(t.orgId)],
);

export type H3Continuity = 'shot' | 'context' | 'context_swap';
export type H3TaskMode = 'i2v' | 'ref' | 'v2v' | 'l2v';

export interface H3ImageDraft {
  fileId: string | null;
  uploadName: string | null;
  uploadWorkerId: string | null;
  /** This picture is included on every segment. */
  shared: boolean;
}

export interface H3SegmentDraft {
  continuity: H3Continuity;
  /** `ref` is what the MiniMax editor shows as R2V. */
  taskMode: H3TaskMode;
  /** How reference photos are sized. `max` fills the frame; `match` keeps their own size. */
  refImageSize?: 'max' | 'match';
  prompt: string;
  audioFileId: string | null;
  audioUploadName: string | null;
  audioUploadWorkerId: string | null;
  /** Seconds. Null means use the scanned file length. */
  durationSec: number | null;
  images: H3ImageDraft[];
}

/** The MiniMax H3 form. Saving it does not start a render. */
export const h3Drafts = pgTable(
  'h3_drafts',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id').references(() => creativeProjects.id, { onDelete: 'set null' }),
    workerId: uuid('worker_id').references(() => gpuWorkers.id, { onDelete: 'set null' }),
    imageFileId: uuid('image_file_id').references(() => fileInstances.id, { onDelete: 'set null' }),
    imageUploadName: text('image_upload_name'),
    imageUploadWorkerId: uuid('image_upload_worker_id').references(() => gpuWorkers.id, { onDelete: 'set null' }),
    prompt: text('prompt').notNull().default(''),
    aspectRatio: text('aspect_ratio').notNull().default('9:16 (Portrait Widescreen)'),
    megapixels: doublePrecision('megapixels').notNull().default(1),
    audioLocked: boolean('audio_locked').notNull().default(true),
    shareAudio: boolean('share_audio').notNull().default(false),
    segments: jsonb('segments').$type<H3SegmentDraft[]>().notNull().default([]),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('h3_drafts_org_uq').on(t.orgId)],
);

/** A Windows Task Scheduler job the owner wants to see and restart. The agent only queries or restarts this name. */
export const windowsTasks = pgTable(
  'windows_tasks',
  {
    id: pk(),
    orgId: orgRef(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    taskName: text('task_name').notNull(),
    status: text('status').notNull().default('UNKNOWN'),
    detail: text('detail'),
    checkedAt: ts('checked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('windows_tasks_device_name_uq').on(t.deviceId, t.taskName), index('windows_tasks_org_idx').on(t.orgId)],
);

/** One owner request to stop and start a saved scheduled task. */
export const windowsTaskRestarts = pgTable(
  'windows_task_restarts',
  {
    id: pk(),
    orgId: orgRef(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => windowsTasks.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('PENDING'),
    error: text('error'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('windows_task_restarts_device_idx').on(t.deviceId, t.status)],
);
