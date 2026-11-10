import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, pk, ts, updatedAt } from './columns';
import { brands, orgRef, organizations } from './identity';

export const aiSettings = pgTable('ai_settings', {
  orgId: uuid('org_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  openaiEnabled: boolean('openai_enabled').notNull().default(true),
  geminiEnabled: boolean('gemini_enabled').notNull().default(true),
  promptModel: text('prompt_model').notNull().default('gpt-5-mini'),
  imageModel: text('image_model').notNull().default('gemini-nano-banana-2.1'),
  videoModel: text('video_model').notNull().default('gemini-2.5-flash'),
  metadataModel: text('metadata_model').notNull().default('gemini-2.5-flash'),
  imageAspect: text('image_aspect').notNull().default('16:9'),
  imageSize: text('image_size').notNull().default('1K'),
  tone: text('tone').notNull().default('cinematic, specific, and natural'),
  timeoutSec: integer('timeout_sec').notNull().default(90),
  maxAttempts: integer('max_attempts').notNull().default(2),
  dailyPromptLimit: integer('daily_prompt_limit').notNull().default(40),
  monthlyPromptLimit: integer('monthly_prompt_limit').notNull().default(400),
  dailyImageLimit: integer('daily_image_limit').notNull().default(4),
  monthlyImageLimit: integer('monthly_image_limit').notNull().default(30),
  dailyVideoLimit: integer('daily_video_limit').notNull().default(4),
  monthlyVideoLimit: integer('monthly_video_limit').notNull().default(20),
  dailyMetadataLimit: integer('daily_metadata_limit').notNull().default(20),
  monthlyMetadataLimit: integer('monthly_metadata_limit').notNull().default(200),
  updatedAt: updatedAt(),
});

export const aiProfiles = pgTable(
  'ai_profiles',
  {
    id: pk(),
    orgId: orgRef(),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default(''),
    niche: text('niche').notNull().default(''),
    languages: text('languages').notNull().default(''),
    tone: text('tone').notNull().default(''),
    voice: text('voice').notNull().default(''),
    themes: text('themes').notNull().default(''),
    visualNotes: text('visual_notes').notNull().default(''),
    avoid: text('avoid').notNull().default(''),
    hashtags: text('hashtags').notNull().default(''),
    links: text('links').notNull().default(''),
    disclosure: text('disclosure').notNull().default(''),
    characterName: text('character_name').notNull().default(''),
    characterNotes: text('character_notes').notNull().default(''),
    referenceFileIds: jsonb('reference_file_ids').$type<string[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ai_profiles_org_brand_uq').on(t.orgId, t.brandId)],
);

export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id'),
    brandId: uuid('brand_id'),
    task: text('task').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull().default('QUEUED'),
    idempotencyKey: text('idempotency_key'),
    targetType: text('target_type'),
    targetId: text('target_id'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb('output').$type<Record<string, unknown> | null>(),
    error: text('error'),
    usage: jsonb('usage').$type<Record<string, unknown> | null>(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('ai_jobs_org_status_idx').on(t.orgId, t.status, t.createdAt),
    uniqueIndex('ai_jobs_idem_uq').on(t.orgId, t.idempotencyKey).where(sql`idempotency_key is not null`),
  ],
);

export const aiPromptVersions = pgTable(
  'ai_prompt_versions',
  {
    id: pk(),
    orgId: orgRef(),
    jobId: uuid('job_id'),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    task: text('task').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    imagePrompt: text('image_prompt').notNull().default(''),
    videoPrompt: text('video_prompt').notNull().default(''),
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    applied: boolean('applied').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('ai_prompt_versions_target_idx').on(t.orgId, t.targetType, t.targetId, t.createdAt)],
);

export const aiAssets = pgTable(
  'ai_assets',
  {
    id: pk(),
    orgId: orgRef(),
    jobId: uuid('job_id'),
    sceneId: uuid('scene_id'),
    projectId: uuid('project_id'),
    kind: text('kind').notNull(),
    path: text('path').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes').notNull().default(0),
    prompt: text('prompt').notNull().default(''),
    model: text('model').notNull().default(''),
    referenceIds: jsonb('reference_ids').$type<string[]>().notNull().default([]),
    approved: boolean('approved').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('ai_assets_scene_idx').on(t.orgId, t.sceneId, t.createdAt)],
);

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: pk(),
    orgId: orgRef(),
    jobId: uuid('job_id'),
    provider: text('provider').notNull(),
    taskGroup: text('task_group').notNull(),
    status: text('status').notNull(),
    images: integer('images').notNull().default(0),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_org_group_idx').on(t.orgId, t.taskGroup, t.createdAt)],
);
