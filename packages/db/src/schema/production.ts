import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, ts, updatedAt } from './columns';
import {
  clipState,
  contentFormat,
  generationStatus,
  goalPeriod,
  ideaStatus,
  outputSelection,
  priority,
  projectStage,
  projectType,
  userRole,
} from './enums';
import { brands, channels, orgRef, users } from './identity';
import { assetVersions, devices, fileInstances, logicalAssets } from './storage';
import { deals } from './crm';

export const contentSeries = pgTable('content_series', {
  id: pk(),
  orgId: orgRef(),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  cadence: text('cadence'),
  targetPerPeriod: integer('target_per_period'),
  period: goalPeriod('period').notNull().default('WEEK'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const ideas = pgTable(
  'ideas',
  {
    id: pk(),
    orgId: orgRef(),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    pitch: text('pitch'),
    creativeBrief: text('creative_brief'),
    notes: text('notes'),
    genre: text('genre'),
    contentPillars: text('content_pillars').array().notNull().default(sql`'{}'::text[]`),
    referenceLinks: text('reference_links').array().notNull().default(sql`'{}'::text[]`),
    voiceNoteFileId: uuid('voice_note_file_id').references(() => fileInstances.id, { onDelete: 'set null' }),
    language: text('language').notNull().default('en'),
    format: contentFormat('format').notNull().default('OTHER'),
    audience: text('audience'),
    score: integer('score'),
    effortHours: integer('effort_hours'),
    priority: priority('priority').notNull().default('NORMAL'),
    status: ideaStatus('status').notNull().default('NEW'),
    storyboard: text('storyboard'),
    lyricsDraft: text('lyrics_draft'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    origin: text('origin').notNull().default('manual'),
    convertedProjectId: uuid('converted_project_id').references((): AnyPgColumn => creativeProjects.id, {
      onDelete: 'set null',
    }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('ideas_org_status_idx').on(t.orgId, t.status), index('ideas_brand_idx').on(t.brandId)],
);

export const creativeProjects = pgTable(
  'creative_projects',
  {
    id: pk(),
    orgId: orgRef(),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    sourceIdeaId: uuid('source_idea_id').references((): AnyPgColumn => ideas.id, { onDelete: 'set null' }),
    seriesId: uuid('series_id').references(() => contentSeries.id, { onDelete: 'set null' }),
    type: projectType('type').notNull().default('OTHER'),
    contentFormat: contentFormat('content_format').notNull().default('OTHER'),
    title: text('title').notNull(),
    stage: projectStage('stage').notNull().default('DRAFT'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: ts('due_at'),
    brief: text('brief'),
    concept: text('concept'),
    approvedDirection: text('approved_direction'),
    parentProjectId: uuid('parent_project_id').references((): AnyPgColumn => creativeProjects.id, {
      onDelete: 'set null',
    }),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    pinned: boolean('pinned').notNull().default(false),
    priority: priority('priority').notNull().default('NORMAL'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    estimatedCompletionAt: ts('estimated_completion_at'),
    completedAt: ts('completed_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('creative_projects_org_stage_idx').on(t.orgId, t.stage),
    index('creative_projects_brand_idx').on(t.brandId),
    index('creative_projects_due_idx').on(t.orgId, t.dueAt),
  ],
);

export const projectMemberships = pgTable(
  'project_memberships',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => creativeProjects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRole('role').notNull().default('EDITOR'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('project_memberships_uq').on(t.projectId, t.userId)],
);

export const projectChecklistTemplates = pgTable('project_checklist_templates', {
  id: pk(),
  orgId: orgRef(),
  key: text('key'),
  name: text('name').notNull(),
  contentType: contentFormat('content_type').notNull().default('OTHER'),
  items: jsonb('items').$type<{ label: string; required: boolean; stage?: string }[]>().notNull().default([]),
  variants: text('variants').array().notNull().default(sql`'{}'::text[]`),
  builtIn: boolean('built_in').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const projectChecklistItems = pgTable(
  'project_checklist_items',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => creativeProjects.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').references(() => projectChecklistTemplates.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    ordinal: integer('ordinal').notNull().default(0),
    stage: text('stage'),
    required: boolean('required').notNull().default(true),
    doneAt: ts('done_at'),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    evidence: text('evidence'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('project_checklist_items_project_idx').on(t.projectId, t.ordinal)],
);

export const songs = pgTable(
  'songs',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id').references(() => creativeProjects.id, { onDelete: 'set null' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    language: text('language').notNull().default('en'),
    genre: text('genre'),
    bpm: integer('bpm'),
    musicalKey: text('musical_key'),
    lyrics: text('lyrics'),
    lyricsAssetId: uuid('lyrics_asset_id').references(() => logicalAssets.id, { onDelete: 'set null' }),
    audioMasterAssetId: uuid('audio_master_asset_id').references(() => logicalAssets.id, { onDelete: 'set null' }),
    sunoUrl: text('suno_url'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('songs_project_idx').on(t.projectId)],
);

export const productionScenes = pgTable(
  'production_scenes',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => creativeProjects.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    title: text('title'),
    timecodeStartMs: integer('timecode_start_ms'),
    timecodeEndMs: integer('timecode_end_ms'),
    narration: text('narration'),
    direction: text('direction'),
    shotPrompt: text('shot_prompt'),
    audioSegmentAssetId: uuid('audio_segment_asset_id').references(() => logicalAssets.id, { onDelete: 'set null' }),
    referenceAssetIds: uuid('reference_asset_ids').array().notNull().default(sql`'{}'::uuid[]`),
    status: clipState('status').notNull().default('PLANNED'),
    selectedVersionId: uuid('selected_version_id').references(() => assetVersions.id, { onDelete: 'set null' }),
    qaNotes: text('qa_notes'),
    approvedAt: ts('approved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('production_scenes_ordinal_uq').on(t.projectId, t.ordinal)],
);

export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id').references(() => creativeProjects.id, { onDelete: 'set null' }),
    sceneId: uuid('scene_id').references(() => productionScenes.id, { onDelete: 'set null' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    provider: text('provider').notNull().default('comfyui'),
    externalJobId: text('external_job_id'),
    promptId: text('prompt_id'),
    attempt: integer('attempt').notNull().default(1),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    status: generationStatus('status').notNull().default('QUEUED'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    workflow: jsonb('workflow').$type<Record<string, unknown>>().notNull().default({}),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('generation_jobs_external_uq')
      .on(t.orgId, t.provider, t.externalJobId)
      .where(sql`${t.externalJobId} is not null`),
    index('generation_jobs_scene_idx').on(t.sceneId),
  ],
);

export const generationOutputs = pgTable(
  'generation_outputs',
  {
    id: pk(),
    orgId: orgRef(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    assetVersionId: uuid('asset_version_id').references(() => assetVersions.id, { onDelete: 'set null' }),
    fileInstanceId: uuid('file_instance_id').references(() => fileInstances.id, { onDelete: 'set null' }),
    expectedPath: text('expected_path'),
    sha256: text('sha256'),
    node: text('node'),
    outputRole: text('output_role').notNull().default('output'),
    startMs: integer('start_ms'),
    endMs: integer('end_ms'),
    selectionState: outputSelection('selection_state').notNull().default('CANDIDATE'),
    createdAt: createdAt(),
  },
  (t) => [index('generation_outputs_job_idx').on(t.jobId), index('generation_outputs_file_idx').on(t.fileInstanceId)],
);

export const projectAttachments = pgTable(
  'project_attachments',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id').references(() => creativeProjects.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references((): AnyPgColumn => deals.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => logicalAssets.id, { onDelete: 'set null' }),
    fileInstanceId: uuid('file_instance_id').references(() => fileInstances.id, { onDelete: 'set null' }),
    label: text('label'),
    purpose: text('purpose').notNull().default('reference'),
    accessLevel: text('access_level').notNull().default('ORG'),
    /** Small uploaded attachments live in the attachments volume; originals are never copied. */
    storedPath: text('stored_path'),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('project_attachments_project_idx').on(t.projectId), index('project_attachments_deal_idx').on(t.dealId)],
);

export const projectStatusEvents = pgTable(
  'project_status_events',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => creativeProjects.id, { onDelete: 'cascade' }),
    fromStage: projectStage('from_stage'),
    toStage: projectStage('to_stage').notNull(),
    source: text('source').notNull().default('user'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('project_status_events_project_idx').on(t.projectId, t.at)],
);

export const projectDecisions = pgTable(
  'project_decisions',
  {
    id: pk(),
    orgId: orgRef(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => creativeProjects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    title: text('title').notNull(),
    decision: text('decision').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts('decided_at').notNull().defaultNow(),
    supersededAt: ts('superseded_at'),
  },
  (t) => [index('project_decisions_project_idx').on(t.projectId, t.version)],
);
