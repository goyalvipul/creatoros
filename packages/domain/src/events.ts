import { z } from 'zod';

/** Versioned event envelope used by the outbox, signed webhooks and the in-app event feed. */
export const EVENT_VERSION = 1;

export const EVENT_TYPES = [
  'media.file.discovered',
  'media.file.updated',
  'media.file.missing',
  'media.file.restored',
  'agent.connected',
  'agent.offline',
  'project.scene.completed',
  'publication.discovered',
  'publication.status.updated',
  'deal.inquiry.detected',
  'deal.reply_required',
  'deal.approval_received',
  'invoice.overdue',
  'invoice.paid',
  'action.created',
  'action.completed',
  'todo.task.updated',
  'connector.sync.failed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const eventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(EVENT_TYPES),
  version: z.literal(EVENT_VERSION),
  occurredAt: z.string().datetime(),
  orgId: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** Inbound webhook: ComfyUI/H3 workflow manifest for exact job -> output linking. */
export const workflowManifestSchema = z.object({
  version: z.literal(1),
  jobId: z.string().min(1),
  promptId: z.string().optional(),
  projectId: z.string().uuid().optional(),
  sceneId: z.string().uuid().optional(),
  provider: z.string().default('comfyui'),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']).default('SUCCEEDED'),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  workflow: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  outputs: z
    .array(
      z.object({
        path: z.string(),
        deviceUuid: z.string().uuid().optional(),
        node: z.string().optional(),
        role: z.string().default('output'),
        startMs: z.number().int().optional(),
        endMs: z.number().int().optional(),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      }),
    )
    .default([]),
  error: z.string().optional(),
});
export type WorkflowManifest = z.infer<typeof workflowManifestSchema>;

export const SIGNATURE_MAX_SKEW_SECONDS = 300;
