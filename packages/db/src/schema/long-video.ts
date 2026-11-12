import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { brands, orgRef } from './identity';

export const longVideoProjects = pgTable(
  'long_video_projects',
  {
    id: pk(),
    orgId: orgRef(),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('DRAFT'),
    aspect: text('aspect').notNull().default('16:9'),
    targetSceneMs: integer('target_scene_ms').notNull().default(10000),
    durationMs: integer('duration_ms'),
    audioPath: text('audio_path'),
    audioName: text('audio_name'),
    audioMime: text('audio_mime'),
    sampleRate: integer('sample_rate'),
    channels: integer('channels'),
    peaks: jsonb('peaks').$type<number[]>().notNull().default([]),
    workerId: uuid('worker_id'),
    creativeProjectId: uuid('creative_project_id'),
    comfyAudioName: text('comfy_audio_name'),
    comfyAudioWorkerId: uuid('comfy_audio_worker_id'),
    style: text('style').notNull().default(''),
    resolution: text('resolution').notNull().default('1'),
    megapixels: doublePrecision('megapixels').notNull().default(1),
    taskMode: text('task_mode').notNull().default('ref'),
    continuity: text('continuity').notNull().default('shot'),
    refSize: text('ref_size').notNull().default('max'),
    fps: integer('fps').notNull().default(30),
    batchState: text('batch_state').notNull().default('off'),
    exportStatus: text('export_status'),
    exportPath: text('export_path'),
    exportError: text('export_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: ts('archived_at'),
  },
  (t) => [index('long_video_projects_org_idx').on(t.orgId, t.updatedAt)],
);

export const longVideoScenes = pgTable(
  'long_video_scenes',
  {
    id: pk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => longVideoProjects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    label: text('label').notNull().default(''),
    mode: text('mode').notNull().default('broll'),
    prompt: text('prompt').notNull().default(''),
    songNotes: text('song_notes').notNull().default(''),
    imageNotes: text('image_notes').notNull().default(''),
    imageOrder: jsonb('image_order').$type<string[]>().notNull().default([]),
    continuity: text('continuity').notNull().default('shot'),
    workerId: uuid('worker_id'),
    status: text('status').notNull().default('DRAFT'),
    jobId: uuid('job_id'),
    shownJobId: uuid('shown_job_id'),
    priorJobId: uuid('prior_job_id'),
    takePath: text('take_path'),
    priorTakePath: text('prior_take_path'),
    outdated: boolean('outdated').notNull().default(false),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('long_video_scenes_project_idx').on(t.projectId, t.position)],
);

export const longVideoRefs = pgTable(
  'long_video_refs',
  {
    id: pk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => longVideoProjects.id, { onDelete: 'cascade' }),
    sceneId: uuid('scene_id').references(() => longVideoScenes.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('image'),
    name: text('name').notNull(),
    path: text('path').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('long_video_refs_project_idx').on(t.projectId)],
);
