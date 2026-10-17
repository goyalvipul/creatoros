import {
  and,
  desc,
  devicePairingCodes,
  deviceCredentials,
  devices,
  eq,
  gt,
  isNull,
  lt,
  organizations,
  sql,
  storageRoots,
  type Db,
} from '@creatoros/db';
import {
  AGENT_PROTOCOL_VERSION,
  SIGNATURE_MAX_SKEW_SECONDS,
  heartbeatSchema,
  osToPathOs,
  type AgentConfig,
  type pairRequestSchema,
} from '@creatoros/domain';
import type { z } from 'zod';
import { audit, emit } from './audit';
import { decrypt, encrypt, hmacHex, pairingCode, randomToken, safeEqualHex, sha256Hex } from './crypto';
import { AppError, notFound, unauthorized, type Ctx, type ServiceEnv } from './types';

const codeHash = (env: ServiceEnv, code: string) =>
  hmacHex(env.agentPairingSecret, code.trim().toUpperCase());

/** One-time expiring pairing code shown in the UI; the agent exchanges it for scoped device credentials. */
export async function createPairingCode(ctx: Ctx, label?: string) {
  const code = pairingCode();
  const expiresAt = new Date(ctx.now().getTime() + ctx.env.pairingCodeTtlMinutes * 60_000);
  await ctx.db.insert(devicePairingCodes).values({
    orgId: ctx.orgId,
    codeHash: codeHash(ctx.env, code),
    label: label ?? null,
    expiresAt,
    createdBy: ctx.userId,
  });
  await audit(ctx, 'device.pairing_code.create', { type: 'device_pairing_code' });
  return { code, expiresAt };
}

export async function pairDevice(
  db: Db,
  env: ServiceEnv,
  input: z.infer<typeof pairRequestSchema>,
  ip?: string,
) {
  const hash = codeHash(env, input.code);
  const now = new Date();
  return db.transaction(async (tx) => {
    // claim the code atomically so a code can never be redeemed twice
    const claimed = await tx
      .update(devicePairingCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(devicePairingCodes.codeHash, hash),
          isNull(devicePairingCodes.usedAt),
          gt(devicePairingCodes.expiresAt, now),
        ),
      )
      .returning();
    const code = claimed[0];
    if (!code)
      throw new AppError(403, 'INVALID_PAIRING_CODE', 'Pairing code is invalid, already used or expired.');
    const token = randomToken(32);
    const signingKey = randomToken(32);
    const displayName = input.label || code.label || input.hostname;
    const [existing] = await tx
      .select()
      .from(devices)
      .where(and(eq(devices.orgId, code.orgId), eq(devices.deviceUuid, input.deviceUuid)));
    let deviceId: string;
    if (existing) {
      deviceId = existing.id;
      await tx
        .update(devices)
        .set({
          hostname: input.hostname,
          os: input.os,
          agentVersion: input.agentVersion,
          displayName: input.label || code.label || existing.displayName,
          state: 'ONLINE',
          revokedAt: null,
          lastSeenAt: now,
          signingKeyEnc: encrypt(signingKey, env.encryptionKey),
          lastError: null,
        })
        .where(eq(devices.id, existing.id));
      await tx
        .update(deviceCredentials)
        .set({ revokedAt: now })
        .where(and(eq(deviceCredentials.deviceId, existing.id), isNull(deviceCredentials.revokedAt)));
    } else {
      const [d] = await tx
        .insert(devices)
        .values({
          orgId: code.orgId,
          deviceUuid: input.deviceUuid,
          displayName,
          hostname: input.hostname,
          os: input.os,
          agentVersion: input.agentVersion,
          hardwareLabel: input.label ?? code.label,
          state: 'ONLINE',
          lastSeenAt: now,
          signingKeyEnc: encrypt(signingKey, env.encryptionKey),
        })
        .returning({ id: devices.id });
      deviceId = d.id;
    }
    const expiresAt = new Date(now.getTime() + env.agentTokenTtlDays * 86400_000);
    await tx.insert(deviceCredentials).values({
      deviceId,
      tokenHash: sha256Hex(token),
      expiresAt,
      pairingAudit: {
        pairedAt: now.toISOString(),
        ip: ip ?? null,
        codeId: code.id,
        hostname: input.hostname,
        agentVersion: input.agentVersion,
      },
    });
    await tx
      .update(devicePairingCodes)
      .set({ usedByDeviceId: deviceId })
      .where(eq(devicePairingCodes.id, code.id));
    await audit(
      { db: tx, orgId: code.orgId, actor: { type: 'agent', id: deviceId }, userId: null, ip },
      'device.paired',
      { type: 'device', id: deviceId },
    );
    await emit(tx, code.orgId, 'agent.connected', { deviceId, hostname: input.hostname, paired: true });
    const [org] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, code.orgId));
    return { deviceId, token, signingKey, expiresAt, orgName: org?.name ?? '' };
  });
}

export interface AuthedAgent {
  deviceId: string;
  orgId: string;
  device: typeof devices.$inferSelect;
  credentialId: string;
  credentialExpiresAt: Date;
}

/** Verify bearer token + HMAC request signature + timestamp skew. Rejects revoked/expired credentials. */
export async function authenticateAgent(
  db: Db,
  env: ServiceEnv,
  req: {
    token: string | undefined;
    timestamp: string | undefined;
    signature: string | undefined;
    body: string | Buffer;
  },
  now = new Date(),
): Promise<AuthedAgent> {
  if (!req.token || !req.timestamp || !req.signature) throw unauthorized('Missing agent credentials');
  const [row] = await db
    .select({ cred: deviceCredentials, device: devices })
    .from(deviceCredentials)
    .innerJoin(devices, eq(devices.id, deviceCredentials.deviceId))
    .where(eq(deviceCredentials.tokenHash, sha256Hex(req.token)))
    .limit(1);
  if (
    !row ||
    row.cred.revokedAt ||
    row.cred.expiresAt <= now ||
    row.device.revokedAt ||
    row.device.state === 'REVOKED'
  ) {
    throw unauthorized('Agent credentials are invalid, expired or revoked');
  }
  const ts = Number(req.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > SIGNATURE_MAX_SKEW_SECONDS)
    throw unauthorized('Request timestamp outside allowed clock skew');
  if (!row.device.signingKeyEnc) throw unauthorized('Device has no signing key');
  const key = decrypt(row.device.signingKeyEnc, env.encryptionKey);
  const expected = hmacHex(key, `${req.timestamp}.${sha256Hex(req.body)}`);
  if (!safeEqualHex(expected, req.signature)) throw unauthorized('Bad request signature');
  return {
    deviceId: row.device.id,
    orgId: row.device.orgId,
    device: row.device,
    credentialId: row.cred.id,
    credentialExpiresAt: row.cred.expiresAt,
  };
}

/** Client-side helper used by tests and tooling to sign requests exactly like the Go agent does. */
export function signAgentRequest(
  signingKey: string,
  body: string | Buffer,
  timestamp = Math.floor(Date.now() / 1000),
) {
  return { timestamp: String(timestamp), signature: hmacHex(signingKey, `${timestamp}.${sha256Hex(body)}`) };
}

export async function rotateAgentToken(db: Db, env: ServiceEnv, agent: AuthedAgent) {
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.agentTokenTtlDays * 86400_000);
  await db.transaction(async (tx) => {
    await tx
      .update(deviceCredentials)
      .set({ revokedAt: now })
      .where(eq(deviceCredentials.id, agent.credentialId));
    await tx.insert(deviceCredentials).values({
      deviceId: agent.deviceId,
      tokenHash: sha256Hex(token),
      expiresAt,
      pairingAudit: { rotatedAt: now.toISOString() },
    });
    await audit(
      { db: tx, orgId: agent.orgId, actor: { type: 'agent', id: agent.deviceId }, userId: null },
      'device.token.rotate',
      { type: 'device', id: agent.deviceId },
    );
  });
  return { token, expiresAt };
}

export async function agentHeartbeat(db: Db, agent: AuthedAgent, input: unknown) {
  const body = heartbeatSchema.parse(input);
  const now = new Date();
  const wasOffline = agent.device.state === 'OFFLINE';
  await db
    .update(devices)
    .set({
      lastSeenAt: now,
      state: 'ONLINE',
      agentVersion: body.agentVersion,
      hostname: body.hostname ?? agent.device.hostname,
      os: body.os ?? agent.device.os,
      listenUrls: body.listenUrls,
      tailscaleHint: body.tailscaleIp ?? agent.device.tailscaleHint,
      load: body.load ?? {},
      lastError: null,
    })
    .where(eq(devices.id, agent.deviceId));
  for (const r of body.roots) {
    const [root] = await db
      .select()
      .from(storageRoots)
      .where(and(eq(storageRoots.id, r.rootId), eq(storageRoots.deviceId, agent.deviceId)));
    if (!root || root.state === 'RETIRED') continue;
    const state = !r.reachable ? 'UNREACHABLE' : root.state === 'UNREACHABLE' ? 'ACTIVE' : root.state;
    await db
      .update(storageRoots)
      .set({
        state,
        lastHeartbeatAt: now,
        health: {
          reachable: r.reachable,
          error: r.error ?? null,
          freeBytes: r.freeBytes ?? null,
          totalBytes: r.totalBytes ?? null,
          queueDepth: r.queueDepth ?? 0,
          scanning: r.scanning ?? false,
          at: now.toISOString(),
        },
        // a root that became reachable again after being unreachable/offline gets a full reconcile
        ...(r.reachable && (root.state === 'UNREACHABLE' || wasOffline) ? { reconcileRequestedAt: now } : {}),
      })
      .where(eq(storageRoots.id, root.id));
  }
  if (wasOffline)
    await emit(db, agent.orgId, 'agent.connected', { deviceId: agent.deviceId, reconnected: true });
  return getAgentConfig(db, agent);
}

export async function getAgentConfig(db: Db, agent: AuthedAgent): Promise<AgentConfig> {
  const roots = await db
    .select()
    .from(storageRoots)
    .where(and(eq(storageRoots.deviceId, agent.deviceId), sql`${storageRoots.state} <> 'RETIRED'`));
  return {
    deviceId: agent.deviceId,
    protocol: AGENT_PROTOCOL_VERSION,
    heartbeatSeconds: 30,
    maxConcurrentHash: 1,
    revoked: false,
    roots: roots.map((r) => ({
      rootId: r.id,
      displayPath: r.displayPath,
      recursive: r.recursive,
      includeGlobs: r.includeGlobs,
      excludeGlobs: r.excludeGlobs,
      extensions: r.extensions,
      scanIntervalMinutes: r.scanIntervalMinutes,
      settleSeconds: r.settleSeconds,
      hashMode: r.hashMode,
      followLinks: r.followLinks,
      state: r.state,
      scanRequested: r.scanRequestedAt !== null,
      reconcileRequested: r.reconcileRequestedAt !== null,
    })),
  };
}

export async function listDevices(ctx: Ctx) {
  const rows = await ctx.db
    .select({
      id: devices.id,
      deviceUuid: devices.deviceUuid,
      displayName: devices.displayName,
      hostname: devices.hostname,
      os: devices.os,
      hardwareLabel: devices.hardwareLabel,
      agentVersion: devices.agentVersion,
      lastSeenAt: devices.lastSeenAt,
      state: devices.state,
      tailscaleHint: devices.tailscaleHint,
      listenUrls: devices.listenUrls,
      lastError: devices.lastError,
      load: devices.load,
      createdAt: devices.createdAt,
      rootCount: sql<number>`(select count(*)::int from storage_roots r where r.device_id = ${devices.id} and r.state <> 'RETIRED')`,
      fileCount: sql<number>`(select count(*)::int from file_instances f where f.device_id = ${devices.id} and f.archived_at is null)`,
      totalBytes: sql<number>`(select coalesce(sum(f.size),0)::bigint from file_instances f where f.device_id = ${devices.id} and f.archived_at is null and f.availability <> 'CONFIRMED_MISSING')`,
    })
    .from(devices)
    .where(eq(devices.orgId, ctx.orgId))
    .orderBy(devices.displayName);
  return rows;
}

export async function updateDevice(
  ctx: Ctx,
  id: string,
  patch: { displayName?: string; hardwareLabel?: string | null },
) {
  const [row] = await ctx.db
    .update(devices)
    .set({
      ...(patch.displayName ? { displayName: patch.displayName } : {}),
      ...(patch.hardwareLabel !== undefined ? { hardwareLabel: patch.hardwareLabel } : {}),
    })
    .where(and(eq(devices.id, id), eq(devices.orgId, ctx.orgId)))
    .returning();
  if (!row) throw notFound('Device');
  await audit(ctx, 'device.update', { type: 'device', id }, undefined, patch);
  return row;
}

/** Revocation is non-destructive: inventory stays, files simply show as machine offline. */
export async function revokeDevice(ctx: Ctx, id: string) {
  const now = ctx.now();
  const [d] = await ctx.db
    .select()
    .from(devices)
    .where(and(eq(devices.id, id), eq(devices.orgId, ctx.orgId)));
  if (!d) throw notFound('Device');
  await ctx.db.transaction(async (tx) => {
    await tx.update(devices).set({ state: 'REVOKED', revokedAt: now }).where(eq(devices.id, id));
    await tx
      .update(deviceCredentials)
      .set({ revokedAt: now })
      .where(and(eq(deviceCredentials.deviceId, id), isNull(deviceCredentials.revokedAt)));
    await audit({ ...ctx, db: tx }, 'device.revoke', { type: 'device', id });
  });
  return { ok: true };
}

/** Worker job: devices that stopped heartbeating become OFFLINE. Files are NEVER marked missing because of this. */
export async function markStaleDevicesOffline(db: Db, env: ServiceEnv, now = new Date()) {
  const cutoff = new Date(now.getTime() - env.agentOfflineAfterSeconds * 1000);
  const stale = await db
    .update(devices)
    .set({ state: 'OFFLINE' })
    .where(and(eq(devices.state, 'ONLINE'), lt(devices.lastSeenAt, cutoff)))
    .returning({ id: devices.id, orgId: devices.orgId, displayName: devices.displayName });
  for (const d of stale) await emit(db, d.orgId, 'agent.offline', { deviceId: d.id, name: d.displayName });
  return stale;
}

/** Short-lived HMAC for API -> agent file streaming requests (agent validates root allow-list too). */
export function signAgentFetch(signingKey: string, rootId: string, path: string, expSeconds: number): string {
  return hmacHex(signingKey, `fetch|${rootId}|${path}|${expSeconds}`);
}

export async function getDeviceSigningKey(env: ServiceEnv, deviceId: string, db: Db): Promise<string | null> {
  const [d] = await db.select({ k: devices.signingKeyEnc }).from(devices).where(eq(devices.id, deviceId));
  return d?.k ? decrypt(d.k, env.encryptionKey) : null;
}

export async function listPairingCodes(ctx: Ctx) {
  return ctx.db
    .select({
      id: devicePairingCodes.id,
      label: devicePairingCodes.label,
      expiresAt: devicePairingCodes.expiresAt,
      usedAt: devicePairingCodes.usedAt,
      createdAt: devicePairingCodes.createdAt,
    })
    .from(devicePairingCodes)
    .where(eq(devicePairingCodes.orgId, ctx.orgId))
    .orderBy(desc(devicePairingCodes.createdAt))
    .limit(20);
}

export function pathOsOf(device: { os: string | null }, samplePath?: string) {
  return osToPathOs(device.os, samplePath);
}
