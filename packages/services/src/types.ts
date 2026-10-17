import type { Db, Executor } from '@creatoros/db';

export interface ServiceEnv {
  /** 32 byte AES-256-GCM key. Lives outside the DB (env/volume), never committed. */
  encryptionKey: Buffer;
  /** Secret mixed into pairing-code hashes and signed media tokens. */
  agentPairingSecret: string;
  appBaseUrl: string;
  mediaPreviewDir: string;
  mediaPreviewMaxGb: number;
  attachmentsDir: string;
  backupDir: string;
  databaseUrl?: string;
  agentTokenTtlDays: number;
  pairingCodeTtlMinutes: number;
  agentOfflineAfterSeconds: number;
  /** Raw process env passthrough for connector configuration (GOOGLE_*, TODO_*, POSTIZ_*). */
  processEnv: Record<string, string | undefined>;
}

export type Actor = { type: 'user' | 'agent' | 'system'; id?: string | null };

export interface Ctx {
  db: Db;
  env: ServiceEnv;
  orgId: string;
  userId: string | null;
  actor: Actor;
  now: () => Date;
  correlationId?: string;
  ip?: string;
}

export type { Db, Executor };

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') => new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not allowed') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown, code = 'CONFLICT') => new AppError(409, code, message, details);
export const unprocessable = (message: string, details?: unknown) => new AppError(422, 'UNPROCESSABLE', message, details);
export const tooMany = (message = 'Too many requests') => new AppError(429, 'RATE_LIMITED', message);

export function systemCtx(base: Pick<Ctx, 'db' | 'env'>, orgId: string): Ctx {
  return { ...base, orgId, userId: null, actor: { type: 'system' }, now: () => new Date() };
}
