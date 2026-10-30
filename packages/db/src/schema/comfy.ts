import { boolean, doublePrecision, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { orgRef, users } from './identity';
import { creativeProjects } from './production';
import { fileInstances } from './storage';

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
