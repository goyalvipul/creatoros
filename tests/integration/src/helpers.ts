import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createDb, organizations, organizationMemberships, users, type DbHandle } from '@creatoros/db';
import {
  createPairingCode,
  createRoot,
  deriveKey,
  pairDevice,
  authenticateAgent,
  seedOrgDefaults,
  signAgentRequest,
  type AuthedAgent,
  type Ctx,
  type ServiceEnv,
} from '@creatoros/services';

export function testEnv(over: Partial<ServiceEnv> = {}): ServiceEnv {
  return {
    encryptionKey: deriveKey('test-encryption-key'),
    agentPairingSecret: 'test-pairing-secret',
    appBaseUrl: 'http://localhost:3000',
    mediaPreviewDir: path.join(os.tmpdir(), 'creatoros-test-previews'),
    mediaPreviewMaxGb: 1,
    attachmentsDir: path.join(os.tmpdir(), 'creatoros-test-attachments'),
    backupDir: path.join(os.tmpdir(), 'creatoros-test-backups'),
    databaseUrl: process.env.TEST_DATABASE_URL,
    agentTokenTtlDays: 90,
    pairingCodeTtlMinutes: 15,
    agentOfflineAfterSeconds: 180,
    processEnv: {},
    ...over,
  };
}

export function openDb(): DbHandle {
  return createDb(process.env.TEST_DATABASE_URL!, { max: 4 });
}

/** Creates an isolated organization (every owned table is org scoped, so tests never collide). */
export async function makeOrg(h: DbHandle, env = testEnv(), name = 'Test Org') {
  const [u] = await h.db
    .insert(users)
    .values({ email: `${randomUUID()}@test.local`, passwordHash: 'x', name: 'Owner', role: 'OWNER', timezone: 'America/Vancouver' })
    .returning({ id: users.id });
  const [o] = await h.db.insert(organizations).values({ name, ownerUserId: u!.id }).returning({ id: organizations.id });
  await h.db.insert(organizationMemberships).values({ orgId: o!.id, userId: u!.id, role: 'OWNER' });
  await seedOrgDefaults(h.db, o!.id, u!.id, 'America/Vancouver');
  const ctx: Ctx = { db: h.db, env, orgId: o!.id, userId: u!.id, actor: { type: 'user', id: u!.id }, now: () => new Date() };
  return { orgId: o!.id, userId: u!.id, ctx, env };
}

export async function pairTestDevice(ctx: Ctx, os = 'windows', hostname = 'TEST-PC') {
  const { code } = await createPairingCode(ctx, hostname);
  const paired = await pairDevice(ctx.db, ctx.env, {
    code,
    deviceUuid: randomUUID(),
    hostname,
    os,
    agentVersion: '1.0.0-test',
  });
  const authFor = async (body: string): Promise<AuthedAgent> => {
    const sig = signAgentRequest(paired.signingKey, body);
    return authenticateAgent(ctx.db, ctx.env, { token: paired.token, timestamp: sig.timestamp, signature: sig.signature, body });
  };
  return { ...paired, authFor };
}

export async function makeRoot(ctx: Ctx, deviceId: string, displayPath = 'D:\\Media', extra: Record<string, unknown> = {}) {
  return createRoot(ctx, { deviceId, label: displayPath, displayPath, ...extra } as any);
}

// ---------------------------------------------------------------- API helpers

import { runMigrations } from '@creatoros/db/migrate';
import { buildApp } from '@creatoros/api';
import { loadConfig, type AppConfig } from '@creatoros/services';
import pgLib from 'pg';

/** A brand-new migrated database in the same Postgres server (needed for first-run/bootstrap tests). */
export async function freshDb(): Promise<{ handle: DbHandle; url: string; drop: () => Promise<void> }> {
  const base = new URL(process.env.TEST_DATABASE_URL!);
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pgLib.Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  base.pathname = `/${name}`;
  const url = base.toString();
  const handle = createDb(url, { max: 4 });
  await runMigrations(handle.db);
  return {
    handle,
    url,
    drop: async () => {
      await handle.close();
      const a = new pgLib.Client({ connectionString: process.env.TEST_DATABASE_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export function testConfig(databaseUrl: string, over: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    ENCRYPTION_KEY: 'test-encryption-key-0123456789',
    AGENT_PAIRING_SECRET: 'test-pairing-secret-0123456789',
    WORKFLOW_WEBHOOK_SECRET: 'test-workflow-secret-0123456789',
    APP_BASE_URL: 'http://localhost:8080',
    LOG_LEVEL: 'silent',
    LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    GLOBAL_RATE_LIMIT_PER_MINUTE: '1000000',
    DATA_DIR: path.join(os.tmpdir(), 'creatoros-test-data'),
    ...over,
  });
}

export interface Api {
  app: Awaited<ReturnType<typeof buildApp>>;
  config: AppConfig;
  call: (method: string, url: string, opts?: { body?: unknown; cookie?: string; headers?: Record<string, string>; raw?: string | Buffer }) => Promise<{ status: number; body: any; headers: Record<string, any>; cookie?: string; raw: Buffer }>;
  login: (email: string, password: string, totp?: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function makeApi(handle: DbHandle, url: string, over: Record<string, string> = {}): Promise<Api> {
  const config = testConfig(url, over);
  const app = await buildApp({ db: handle.db, config });
  await app.ready();
  const call: Api['call'] = async (method, u, opts = {}) => {
    const headers: Record<string, string> = { 'x-requested-with': 'test', ...(opts.headers ?? {}) };
    if (opts.cookie) headers.cookie = opts.cookie;
    let payload: any = undefined;
    if (opts.raw !== undefined) payload = opts.raw;
    else if (opts.body !== undefined) {
      payload = JSON.stringify(opts.body);
      headers['content-type'] ??= 'application/json';
    }
    const res = await app.inject({ method: method as any, url: u, headers, payload });
    const setCookie = ([] as string[]).concat((res.headers['set-cookie'] as any) ?? []).find((c) => c.startsWith('cos_session='));
    let body: any = undefined;
    const text = res.body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    return { status: res.statusCode, body, headers: res.headers as any, cookie: setCookie?.split(';')[0], raw: res.rawPayload };
  };
  const login = async (email: string, password: string, totp?: string) => {
    const r = await call('POST', '/api/v1/auth/login', { body: { email, password, totp } });
    if (r.status !== 200 || !r.cookie) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
    return r.cookie;
  };
  return { app, config, call, login, close: () => app.close() };
}

/** Runs pg_dump / pg_restore / psql inside the disposable Postgres container (the host has no PostgreSQL client tools). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { Runner } from '@creatoros/services';
import { localRunner } from '@creatoros/services';

export function dockerRunner(container: string | undefined = process.env.TEST_PG_CONTAINER): Runner {
  if (!container) return localRunner;
  return (cmd, args, opts = {}) => {
    if (!['pg_dump', 'pg_restore', 'psql'].includes(cmd)) return localRunner(cmd, args, opts);
    // inside the container Postgres listens on the default socket; drop host/port/user flags aimed at the published port
    const cleaned: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-h' || args[i] === '-p') {
        i++;
        continue;
      }
      cleaned.push(args[i]!);
    }
    const dockerArgs = ['exec', '-i', ...Object.entries(opts.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]), container, cmd, ...cleaned];
    return new Promise((resolve, reject) => {
      const child = spawn('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      if (opts.stdoutFile) child.stdout.pipe(fs.createWriteStream(opts.stdoutFile));
      else child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      if (opts.stdinFile) fs.createReadStream(opts.stdinFile).pipe(child.stdin);
      else child.stdin.end();
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(0, 800)}`))));
    });
  };
}
