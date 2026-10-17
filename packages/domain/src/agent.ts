import { z } from 'zod';
import { HASH_MODE } from './enums';

/** Wire contract between the Go scanner agent and the API. Version bumps require a new path. */
export const AGENT_PROTOCOL_VERSION = 1;

export const probeSchema = z
  .object({
    durationMs: z.number().nonnegative().optional(),
    fps: z.number().nonnegative().optional(),
    width: z.number().int().nonnegative().optional(),
    height: z.number().int().nonnegative().optional(),
    codec: z.string().optional(),
    audioCodec: z.string().optional(),
    hasAudio: z.boolean().optional(),
    bitrate: z.number().nonnegative().optional(),
    rotation: z.number().optional(),
    formatName: z.string().optional(),
    mime: z.string().optional(),
    creationTime: z.string().optional(),
    /** Recognised ComfyUI/H3 workflow metadata when present in the container tags. */
    workflow: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const observationSchema = z.object({
  /** `${runId}:${seq}` – unique per observation, makes replays idempotent. */
  eventId: z.string().min(3).max(120),
  seq: z.number().int().nonnegative(),
  kind: z.enum(['file', 'hash', 'probe', 'error']),
  path: z.string().min(1).max(4096),
  fileId: z.string().max(200).optional(),
  size: z.number().int().nonnegative().default(0),
  mtimeMs: z.number().nonnegative().default(0),
  ctimeMs: z.number().nonnegative().optional(),
  mtimePrecisionMs: z.number().nonnegative().optional(),
  state: z.enum(['STABLE', 'STILL_WRITING', 'PERMISSION_DENIED', 'INCOMPLETE']).default('STABLE'),
  stableObservations: z.number().int().nonnegative().default(1),
  quickSignature: z.string().max(200).optional(),
  fullHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  hashAlg: z.literal('sha256').optional(),
  ext: z.string().max(20).optional(),
  probeState: z.enum(['PENDING', 'STILL_WRITING', 'PROBING', 'INDEXED', 'PROBE_FAILED']).optional(),
  probe: probeSchema.optional(),
  error: z.string().max(1000).optional(),
});
export type Observation = z.infer<typeof observationSchema>;

export const ingestBatchSchema = z.object({
  rootId: z.string().uuid(),
  runId: z.string().uuid(),
  jobType: z.enum(['SCAN', 'RECONCILE', 'HEARTBEAT']).default('SCAN'),
  phase: z.enum(['START', 'PROGRESS', 'END']).default('PROGRESS'),
  /** Only meaningful on END: scanner walked the entire root with no traversal failure. */
  complete: z.boolean().optional(),
  counts: z
    .object({ scanned: z.number().int().nonnegative(), errors: z.number().int().nonnegative() })
    .optional(),
  errors: z
    .array(z.object({ path: z.string(), error: z.string() }))
    .max(200)
    .optional(),
  observations: z.array(observationSchema).max(1000).default([]),
});
export type IngestBatch = z.infer<typeof ingestBatchSchema>;

export const ingestResponseSchema = z.object({
  ack: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  wantHash: z.array(z.object({ path: z.string(), rootId: z.string().uuid() })),
  wantPreview: z.array(z.object({ instanceId: z.string().uuid(), path: z.string() })),
  serverTime: z.string(),
});
export type IngestResponse = z.infer<typeof ingestResponseSchema>;

export const pairRequestSchema = z.object({
  code: z.string().min(6).max(64),
  deviceUuid: z.string().uuid(),
  hostname: z.string().min(1).max(255),
  os: z.string().min(1).max(100),
  agentVersion: z.string().min(1).max(50),
  label: z.string().max(100).optional(),
});

export const heartbeatSchema = z.object({
  agentVersion: z.string().max(50),
  hostname: z.string().max(255).optional(),
  os: z.string().max(100).optional(),
  listenUrls: z.array(z.string().url()).max(10).default([]),
  tailscaleIp: z.string().max(100).optional(),
  load: z.object({ cpuPct: z.number().optional(), scanning: z.boolean().optional() }).optional(),
  roots: z
    .array(
      z.object({
        rootId: z.string().uuid(),
        reachable: z.boolean(),
        error: z.string().max(500).optional(),
        freeBytes: z.number().nonnegative().optional(),
        totalBytes: z.number().nonnegative().optional(),
        queueDepth: z.number().int().nonnegative().optional(),
        scanning: z.boolean().optional(),
      }),
    )
    .default([]),
});

export const agentRootConfigSchema = z.object({
  rootId: z.string().uuid(),
  displayPath: z.string(),
  recursive: z.boolean(),
  includeGlobs: z.array(z.string()),
  excludeGlobs: z.array(z.string()),
  extensions: z.array(z.string()),
  scanIntervalMinutes: z.number().int(),
  settleSeconds: z.number().int(),
  hashMode: z.enum(HASH_MODE),
  followLinks: z.boolean(),
  state: z.string(),
  scanRequested: z.boolean(),
  reconcileRequested: z.boolean(),
});
export type AgentRootConfig = z.infer<typeof agentRootConfigSchema>;

export const agentConfigSchema = z.object({
  deviceId: z.string().uuid(),
  protocol: z.number().int(),
  heartbeatSeconds: z.number().int(),
  maxConcurrentHash: z.number().int(),
  roots: z.array(agentRootConfigSchema),
  revoked: z.boolean(),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/** Header names for the HMAC request signature. signature = HMAC_SHA256(key, `${ts}.${sha256(body)}`) */
export const AGENT_HEADERS = {
  timestamp: 'x-agent-timestamp',
  signature: 'x-agent-signature',
  device: 'x-agent-device',
} as const;
