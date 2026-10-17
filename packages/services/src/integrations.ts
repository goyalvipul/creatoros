import {
  and,
  eq,
  oauthStates,
  providerConnections,
  socialAccounts,
  sql,
  syncCursors,
  taskIntegrations,
  type Db,
} from '@creatoros/db';
import {
  CONNECTORS,
  ConnectorError,
  exchangeGoogleCode,
  getConnector,
  readGoogleClientConfig,
  revokeGoogleToken,
  type ConnectorContext,
  type Credentials,
  type NormalizedEmail,
  type NormalizedPost,
} from '@creatoros/connectors';
import { PROVIDER, type Provider } from '@creatoros/domain';
import { audit, emit } from './audit';
import { decrypt, decryptJson, encrypt, encryptJson, sha256Hex } from './crypto';
import { importPublications } from './publishing';
import { ingestMessage } from './crm';
import { badRequest, notFound, systemCtx, type Ctx, type ServiceEnv } from './types';

type Conn = typeof providerConnections.$inferSelect;

export function loadCredentials(env: ServiceEnv, conn: Conn | null | undefined): Credentials {
  if (!conn?.encryptedTokenRef) return {};
  try {
    return decryptJson<Credentials>(conn.encryptedTokenRef, env.encryptionKey);
  } catch {
    return {};
  }
}

/** Builds the connector runtime context. Token refreshes are persisted encrypted; the real `fetch` is used (inject another for tests). */
export function connectorContext(db: Db, env: ServiceEnv, conn: Conn | null | undefined, overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    credentials: loadCredentials(env, conn),
    config: { googleClient: readGoogleClientConfig(env.processEnv) ?? undefined, ...(conn?.config ?? {}) },
    onCredentials: async (c) => {
      if (!conn) return;
      await db.update(providerConnections).set({ encryptedTokenRef: encryptJson(c, env.encryptionKey), expiresAt: c.expiresAt ? new Date(c.expiresAt) : null, updatedAt: new Date() }).where(eq(providerConnections.id, conn.id));
    },
    ...overrides,
  };
}

const publicConn = (c: Conn) => ({ id: c.id, provider: c.provider, label: c.label, principalHint: c.principalHint, state: c.state, scopes: c.scopes, expiresAt: c.expiresAt, lastSyncAt: c.lastSyncAt, lastError: c.lastError, config: redactConfig(c.config) });
function redactConfig(cfg: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg ?? {})) out[k] = /secret|token|key|password/i.test(k) ? '***' : v;
  return out;
}

/** One row per provider: honest state + capabilities + exact setup steps. Never exposes secrets. */
export async function listIntegrations(ctx: Ctx, overrides: Partial<ConnectorContext> = {}) {
  const conns = await ctx.db.select().from(providerConnections).where(eq(providerConnections.orgId, ctx.orgId));
  const out = [];
  for (const provider of PROVIDER) {
    const conn = conns.filter((c) => c.provider === provider).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    const connector = getConnector(provider);
    let caps;
    try {
      caps = await connector.getCapabilities(connectorContext(ctx.db, ctx.env, conn, overrides));
    } catch (e) {
      caps = { provider, state: 'ERROR' as const, read: false, write: false, incrementalSync: false, flags: {}, blockers: [(e as Error).message], setupSteps: [] };
    }
    const cursors = conn ? await ctx.db.select().from(syncCursors).where(eq(syncCursors.connectionId, conn.id)) : [];
    out.push({
      provider,
      connection: conn ? publicConn(conn) : null,
      state: conn && conn.state !== 'NOT_CONFIGURED' ? conn.state : caps.state,
      capabilities: caps,
      cursors: cursors.map((c) => ({ scope: c.scope, lastSuccessAt: c.lastSuccessAt, restartRequired: c.restartRequired })),
    });
  }
  return out;
}

async function setState(db: Db, conn: Conn, state: Conn['state'], lastError: string | null) {
  await db.update(providerConnections).set({ state, lastError, updatedAt: new Date() }).where(eq(providerConnections.id, conn.id));
}

// -------------------------------------------------------------------- OAuth

export async function startOAuth(ctx: Ctx, provider: 'gmail' | 'youtube', input: { drafts?: boolean; analytics?: boolean; loginHint?: string } = {}, overrides: Partial<ConnectorContext> = {}) {
  const connector = getConnector(provider);
  const cctx = connectorContext(ctx.db, ctx.env, null, overrides);
  const res = await connector.connect(cctx, input);
  if (res.status !== 'REDIRECT' || !res.oauth) return { status: res.status, steps: res.steps ?? [], authorizeUrl: null };
  await ctx.db.insert(oauthStates).values({
    orgId: ctx.orgId,
    userId: ctx.userId,
    provider,
    stateHash: sha256Hex(res.oauth.state),
    codeVerifierEnc: encrypt(res.oauth.verifier, ctx.env.encryptionKey),
    scopes: res.oauth.scopes,
    redirectUri: (cctx.config.googleClient as any)?.redirectUri ?? '',
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  await audit(ctx, 'integration.oauth.start', { type: 'provider', id: provider }, undefined, { scopes: res.oauth.scopes });
  return { status: 'REDIRECT' as const, authorizeUrl: res.authorizeUrl!, steps: [] };
}

/** OAuth callback: validates single-use state (CSRF + PKCE), exchanges the code and stores tokens encrypted. */
export async function completeOAuth(db: Db, env: ServiceEnv, input: { state: string; code?: string; error?: string }, overrides: Partial<ConnectorContext> = {}) {
  const [st] = await db.select().from(oauthStates).where(eq(oauthStates.stateHash, sha256Hex(input.state)));
  if (!st || st.usedAt || st.expiresAt < new Date()) throw badRequest('This authorization request is invalid or has expired. Start the connection again.', undefined, 'OAUTH_STATE_INVALID');
  await db.update(oauthStates).set({ usedAt: new Date() }).where(eq(oauthStates.id, st.id));
  if (input.error || !input.code) throw badRequest(`Authorization was not granted${input.error ? `: ${input.error}` : ''}.`, undefined, 'OAUTH_DENIED');
  const client = readGoogleClientConfig(env.processEnv);
  if (!client) throw badRequest('Google OAuth client is not configured on the server.', undefined, 'NOT_CONFIGURED');
  const cctx = connectorContext(db, env, null, overrides);
  const creds = await exchangeGoogleCode(cctx, client, input.code, decrypt(st.codeVerifierEnc, env.encryptionKey));
  const existing = (await db.select().from(providerConnections).where(and(eq(providerConnections.orgId, st.orgId), eq(providerConnections.provider, st.provider)))).find((c) => !creds.principal || !c.principalHint || c.principalHint === creds.principal);
  const values = { encryptedTokenRef: encryptJson(creds, env.encryptionKey), scopes: creds.scopes?.length ? creds.scopes : st.scopes, principalHint: creds.principal ?? existing?.principalHint ?? null, expiresAt: creds.expiresAt ? new Date(creds.expiresAt) : null, state: 'ACTIVE' as const, lastError: null, updatedAt: new Date() };
  let id: string;
  if (existing) {
    // keep the old refresh token if Google did not return a new one
    if (!creds.refreshToken) {
      const old = loadCredentials(env, existing);
      if (old.refreshToken) values.encryptedTokenRef = encryptJson({ ...creds, refreshToken: old.refreshToken }, env.encryptionKey);
    }
    await db.update(providerConnections).set(values).where(eq(providerConnections.id, existing.id));
    id = existing.id;
  } else {
    const [c] = await db.insert(providerConnections).values({ orgId: st.orgId, provider: st.provider, label: creds.principal ?? st.provider, config: {}, ...values }).returning({ id: providerConnections.id });
    id = c!.id;
  }
  await audit({ db, orgId: st.orgId, actor: { type: 'user', id: st.userId }, userId: st.userId }, 'integration.connected', { type: 'provider_connection', id }, undefined, { provider: st.provider, scopes: values.scopes });
  return { connectionId: id, provider: st.provider, principal: creds.principal ?? null };
}

export async function disconnect(ctx: Ctx, connectionId: string, overrides: Partial<ConnectorContext> = {}) {
  const [conn] = await ctx.db.select().from(providerConnections).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.orgId, ctx.orgId)));
  if (!conn) throw notFound('Connection');
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  if (conn.provider === 'gmail' || conn.provider === 'youtube') await revokeGoogleToken(cctx);
  await ctx.db.update(providerConnections).set({ encryptedTokenRef: null, state: 'NOT_CONFIGURED', expiresAt: null, lastError: null, updatedAt: new Date() }).where(eq(providerConnections.id, connectionId));
  await ctx.db.delete(syncCursors).where(eq(syncCursors.connectionId, connectionId));
  await audit(ctx, 'integration.disconnected', { type: 'provider_connection', id: connectionId }, undefined, { provider: conn.provider });
  return { disconnected: true }; // imported records stay; only credentials and cursors are removed
}

export async function setConnectionPaused(ctx: Ctx, connectionId: string, paused: boolean) {
  const [conn] = await ctx.db.select().from(providerConnections).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.orgId, ctx.orgId)));
  if (!conn) throw notFound('Connection');
  await setState(ctx.db, conn, paused ? 'PAUSED' : 'ACTIVE', conn.lastError);
  return { state: paused ? 'PAUSED' : 'ACTIVE' };
}

/** Todo (and other key-based) providers: store config + secret. The state only becomes ACTIVE after a successful health test. */
export async function saveKeyConnection(ctx: Ctx, provider: 'todo' | 'postiz' | 'meta' | 'tiktok', input: { label?: string; apiKey?: string; accessToken?: string; config?: Record<string, unknown> }) {
  const [existing] = await ctx.db.select().from(providerConnections).where(and(eq(providerConnections.orgId, ctx.orgId), eq(providerConnections.provider, provider)));
  const prev = loadCredentials(ctx.env, existing);
  const creds: Credentials = { ...prev, ...(input.apiKey ? { apiKey: input.apiKey } : {}), ...(input.accessToken ? { accessToken: input.accessToken } : {}) };
  const values = { label: input.label ?? existing?.label ?? provider, config: { ...(existing?.config ?? {}), ...(input.config ?? {}) }, encryptedTokenRef: Object.keys(creds).length ? encryptJson(creds, ctx.env.encryptionKey) : null, state: 'NOT_CONFIGURED' as const, updatedAt: new Date() };
  let id: string;
  if (existing) {
    await ctx.db.update(providerConnections).set(values).where(eq(providerConnections.id, existing.id));
    id = existing.id;
  } else {
    const [c] = await ctx.db.insert(providerConnections).values({ orgId: ctx.orgId, provider, ...values }).returning({ id: providerConnections.id });
    id = c!.id;
  }
  if (provider === 'todo') {
    const [ti] = await ctx.db.select().from(taskIntegrations).where(eq(taskIntegrations.orgId, ctx.orgId));
    const cfg = values.config as any;
    const row = { providerConnectionId: id, baseUrl: cfg.baseUrl ?? null, endpointMap: cfg.endpoints ?? {}, fieldMap: cfg.fieldMap ?? {}, updatedAt: new Date() };
    if (ti) await ctx.db.update(taskIntegrations).set(row).where(eq(taskIntegrations.id, ti.id));
    else await ctx.db.insert(taskIntegrations).values({ orgId: ctx.orgId, ...row });
  }
  await audit(ctx, 'integration.configured', { type: 'provider_connection', id }, undefined, { provider, config: redactConfig(values.config) });
  return { connectionId: id };
}

export async function testConnection(ctx: Ctx, provider: Provider, overrides: Partial<ConnectorContext> = {}) {
  const [conn] = await ctx.db.select().from(providerConnections).where(and(eq(providerConnections.orgId, ctx.orgId), eq(providerConnections.provider, provider)));
  if (!conn) throw notFound('Connection');
  const connector = getConnector(provider);
  const h = await connector.health(connectorContext(ctx.db, ctx.env, conn, overrides));
  await setState(ctx.db, conn, h.state, h.ok ? null : (h.detail ?? 'health check failed'));
  if (provider === 'todo' && h.ok) await ctx.db.update(taskIntegrations).set({ enabled: true, lastError: null }).where(eq(taskIntegrations.orgId, ctx.orgId));
  return h;
}

export async function linkSocialAccountToConnection(ctx: Ctx, socialAccountId: string, connectionId: string | null) {
  const [a] = await ctx.db.update(socialAccounts).set({ providerConnectionId: connectionId, updatedAt: new Date() }).where(and(eq(socialAccounts.id, socialAccountId), eq(socialAccounts.orgId, ctx.orgId))).returning();
  if (!a) throw notFound('Social account');
  return a;
}

// --------------------------------------------------------------------- sync

async function getCursor(db: Db, orgId: string, connectionId: string, scope: string) {
  const [c] = await db.select().from(syncCursors).where(and(eq(syncCursors.connectionId, connectionId), eq(syncCursors.scope, scope)));
  return c ?? null;
}
async function saveCursor(db: Db, orgId: string, connectionId: string, scope: string, cursor: string | null) {
  await db
    .insert(syncCursors)
    .values({ orgId, connectionId, scope, cursor, lastSuccessAt: new Date() })
    .onConflictDoUpdate({ target: [syncCursors.connectionId, syncCursors.scope], set: { cursor, lastSuccessAt: new Date(), restartRequired: false, updatedAt: new Date() } });
}

export interface SyncSummary {
  provider: Provider;
  mode: 'full' | 'incremental';
  imported: number;
  duplicates?: number;
  created?: number;
  updated?: number;
  resynced?: boolean;
  skipped?: string;
}

/**
 * Runs one sync for a connection. Resumable (cursor saved only after items were stored), idempotent (message/post ids dedupe), and honest:
 * auth failures flip the connection to AUTH_EXPIRED and emit connector.sync.failed instead of silently doing nothing.
 */
export async function runSync(db: Db, env: ServiceEnv, connectionId: string, opts: { full?: boolean } = {}, overrides: Partial<ConnectorContext> = {}): Promise<SyncSummary> {
  const [conn] = await db.select().from(providerConnections).where(eq(providerConnections.id, connectionId));
  if (!conn) throw notFound('Connection');
  const provider = conn.provider as Provider;
  if (conn.state === 'PAUSED' || conn.state === 'DISABLED') return { provider, mode: 'incremental', imported: 0, skipped: `connection is ${conn.state}` };
  const sys = systemCtx({ db, env }, conn.orgId);
  const connector = getConnector(provider);
  const cctx = connectorContext(db, env, conn, overrides);
  try {
    if (provider === 'gmail') {
      const scope = 'gmail.history';
      const cur = opts.full ? null : (await getCursor(db, conn.orgId, conn.id, scope))?.cursor ?? null;
      const res = cur ? await connector.syncIncremental(cctx, cur) : await connector.syncFull(cctx);
      let imported = 0;
      let duplicates = 0;
      for (const m of res.items as NormalizedEmail[]) {
        const r = await ingestMessage(sys, {
          source: 'GMAIL',
          principal: conn.principalHint,
          providerThreadId: m.providerThreadId,
          providerMsgId: m.providerMsgId,
          direction: m.direction,
          receivedAt: m.receivedAt,
          fromEmail: m.fromEmail,
          fromName: m.fromName,
          toEmails: m.toEmails,
          subject: m.subject,
          body: m.bodyText ?? m.snippet,
          attachmentRefs: m.attachments,
          providerConnectionId: conn.id,
          externalLink: `https://mail.google.com/mail/u/${encodeURIComponent(conn.principalHint ?? '0')}/#all/${m.providerThreadId}`,
        });
        if (r.duplicate) duplicates += 1;
        else imported += 1;
      }
      await saveCursor(db, conn.orgId, conn.id, scope, res.nextCursor);
      await markOk(db, conn);
      return { provider, mode: cur ? 'incremental' : 'full', imported, duplicates, resynced: res.resynced };
    }

    if (provider === 'youtube' || provider === 'meta' || provider === 'tiktok' || provider === 'postiz') {
      const [acct] = await db.select().from(socialAccounts).where(and(eq(socialAccounts.orgId, conn.orgId), eq(socialAccounts.providerConnectionId, conn.id), sql`${socialAccounts.deletedAt} is null`));
      if (!acct) {
        await setState(db, conn, 'PARTIAL_SYNC', `Connected, but no social account is linked to this connection. Add the ${provider} account under Channels and link it here; nothing was imported.`);
        return { provider, mode: 'full', imported: 0, skipped: 'no linked social account' };
      }
      const scope = `${provider}.posts`;
      const cur = opts.full ? null : (await getCursor(db, conn.orgId, conn.id, scope))?.cursor ?? null;
      const res = cur ? await connector.syncIncremental(cctx, cur) : await connector.syncFull(cctx);
      const posts = (res.items as NormalizedPost[]).filter((p) => p.url && p.externalId);
      const r = await importPublications(sys, acct.id, provider === 'youtube' ? 'youtube' : provider, posts.map((p) => ({ externalPostId: p.externalId, url: p.url!, title: p.title, caption: p.description, publishedAt: p.publishedAt, privacy: p.privacy, stats: (p.stats ?? undefined) as any, providerMeta: { thumbnailUrl: p.thumbnailUrl, durationMs: p.durationMs } })));
      await saveCursor(db, conn.orgId, conn.id, scope, res.nextCursor);
      await markOk(db, conn);
      return { provider, mode: cur ? 'incremental' : 'full', imported: posts.length, created: r.created, updated: r.updated };
    }

    return { provider, mode: 'incremental', imported: 0, skipped: 'this provider has no pull sync' };
  } catch (e) {
    const err = e instanceof ConnectorError ? e : new ConnectorError('SERVER', (e as Error).message);
    const state: Conn['state'] = err.kind === 'AUTH_EXPIRED' || err.kind === 'AUTH_REVOKED' ? 'AUTH_EXPIRED' : err.kind === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : err.kind === 'PERMISSION_DENIED' || err.kind === 'UNSUPPORTED' ? 'PARTIAL_SYNC' : err.retryable ? conn.state : 'ERROR';
    await setState(db, conn, state, err.message);
    if (err.kind === 'CURSOR_EXPIRED') await db.update(syncCursors).set({ restartRequired: true }).where(eq(syncCursors.connectionId, conn.id));
    await emit(db, conn.orgId, 'connector.sync.failed', { provider, connectionId: conn.id, kind: err.kind, message: err.message });
    throw err;
  }
}

async function markOk(db: Db, conn: Conn) {
  await db.update(providerConnections).set({ lastSyncAt: new Date(), lastError: null, state: 'ACTIVE', updatedAt: new Date() }).where(eq(providerConnections.id, conn.id));
}

export async function listConnectionsForSync(db: Db) {
  return db.select({ id: providerConnections.id, provider: providerConnections.provider, orgId: providerConnections.orgId }).from(providerConnections).where(sql`${providerConnections.state} in ('ACTIVE','PARTIAL_SYNC') and ${providerConnections.encryptedTokenRef} is not null and ${providerConnections.provider} in ('gmail','youtube','meta','tiktok','postiz')`);
}

void CONNECTORS;
