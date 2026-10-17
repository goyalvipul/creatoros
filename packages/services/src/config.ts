import path from 'node:path';
import { z } from 'zod';
import { deriveKey } from './crypto';
import type { ServiceEnv } from './types';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  APP_BASE_URL: z.string().url().default('http://localhost:8080'),
  /** Extra origins allowed to call the API with cookies (e.g. https://pc.tailnet.ts.net, http://192.168.1.20:8080). */
  ALLOWED_ORIGINS: z.string().default(''),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(4000),
  ENCRYPTION_KEY: z.string().min(16, 'ENCRYPTION_KEY must be at least 16 characters (use a long random value)'),
  AGENT_PAIRING_SECRET: z.string().min(16, 'AGENT_PAIRING_SECRET must be at least 16 characters'),
  WORKFLOW_WEBHOOK_SECRET: z.string().optional(),
  DATA_DIR: z.string().default('./data'),
  MEDIA_PREVIEW_MAX_GB: z.coerce.number().positive().default(5),
  AGENT_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),
  PAIRING_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  AGENT_OFFLINE_AFTER_SECONDS: z.coerce.number().int().positive().default(180),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  GLOBAL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(900),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  env: ServiceEnv;
  databaseUrl: string;
  redisUrl: string;
  host: string;
  port: number;
  allowedOrigins: string[];
  workflowWebhookSecret?: string;
  logLevel: string;
  loginRateLimit: number;
  globalRateLimit: number;
}

/** Reads and validates configuration. There are no default secrets: missing or short secrets fail loudly at start-up. */
export function loadConfig(raw: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}\nCopy .env.example to .env and fill the values (see docs/EXTERNAL_PREREQUISITES.md).`);
  }
  const e = parsed.data;
  const dataDir = path.resolve(e.DATA_DIR);
  const origins = [e.APP_BASE_URL, ...e.ALLOWED_ORIGINS.split(',')].map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    host: e.API_HOST,
    port: e.API_PORT,
    allowedOrigins: [...new Set(origins)],
    workflowWebhookSecret: e.WORKFLOW_WEBHOOK_SECRET,
    logLevel: e.LOG_LEVEL,
    loginRateLimit: e.LOGIN_RATE_LIMIT_PER_MINUTE,
    globalRateLimit: e.GLOBAL_RATE_LIMIT_PER_MINUTE,
    env: {
      encryptionKey: deriveKey(e.ENCRYPTION_KEY),
      agentPairingSecret: e.AGENT_PAIRING_SECRET,
      appBaseUrl: e.APP_BASE_URL.replace(/\/$/, ''),
      mediaPreviewDir: path.join(dataDir, 'previews'),
      mediaPreviewMaxGb: e.MEDIA_PREVIEW_MAX_GB,
      attachmentsDir: path.join(dataDir, 'attachments'),
      backupDir: path.join(dataDir, 'backups'),
      databaseUrl: e.DATABASE_URL,
      agentTokenTtlDays: e.AGENT_TOKEN_TTL_DAYS,
      pairingCodeTtlMinutes: e.PAIRING_CODE_TTL_MINUTES,
      agentOfflineAfterSeconds: e.AGENT_OFFLINE_AFTER_SECONDS,
      processEnv: raw,
    },
  };
}
