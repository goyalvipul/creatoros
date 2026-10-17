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
