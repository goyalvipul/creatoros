import {
  and,
  eq,
  oauthStates,
  providerConnections,
  providerWebhookEvents,
  socialMediaItems,
  sql,
  type Db,
} from '@creatoros/db';
import {
  FACEBOOK_ALL_SCOPES,
  FACEBOOK_SCOPES,
  buildFacebookAuthUrl,
  exchangeFacebookCode,
  fetchFacebookPage,
  listFacebookConversationPage,
  listFacebookCommentsPage,
  listFacebookPages,
  listFacebookPostsPage,
  parseFacebookWebhookEntry,
  readFacebookClientConfig,
  subscribeFacebookPage,
  verifyMetaSignature,
  type ConnectorContext,
} from '@creatoros/connectors';
import { audit } from './audit';
import { encrypt, encryptJson, sha256Hex } from './crypto';
import { connectorContext } from './integrations';
import { autoReconcileConnection } from './identity';
import { ingestSocialEvent, syncInstagramAccount } from './social';
import { processSocialEvent } from './workflows';
import { AppError, badRequest, notFound, systemCtx, type Ctx, type ServiceEnv } from './types';
import { randomBytes } from 'node:crypto';

type Conn = typeof providerConnections.$inferSelect;
const rowsOf = <T>(r: any): T[] => (Array.isArray(r) ? r : (r?.rows ?? [])) as T[];
const clientFor = (env: ServiceEnv) => {
  const c = readFacebookClientConfig({
    ...env.processEnv,
    APP_BASE_URL: env.processEnv.APP_BASE_URL ?? env.appBaseUrl,
  });
  if (!c)
    throw new AppError(
      409,
      'NOT_CONFIGURED',
      'Facebook is not configured: set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET (the parent Meta app, App settings > Basic) in .env and restart.',
    );
  return c;
};

export const FACEBOOK_SETUP_STEPS = [
  'Meta app > App settings > Basic: copy the App ID and App secret into FACEBOOK_APP_ID / FACEBOOK_APP_SECRET in .env.',
  'Facebook Login > Settings: add the redirect URI https://<your host>/api/v1/integrations/meta/facebook/callback.',
  'Webhooks > Page: callback URL https://<your host>/api/v1/integrations/meta/facebook/webhook, verify token = META_WEBHOOK_VERIFY_TOKEN, subscribe messages and feed.',
  'App roles: the Facebook account that manages the Page must be an Administrator/Developer/Tester of the app.',
];

// ------------------------------------------------------------------ connect

/** Starts Facebook Login. Nothing is connected until the owner approves in Facebook and chooses Pages. */
export async function startFacebookOAuth(ctx: Ctx) {
  const client = clientFor(ctx.env);
  const state = randomBytes(24).toString('base64url');
  await ctx.db.insert(oauthStates).values({
    orgId: ctx.orgId,
    userId: ctx.userId,
    provider: 'facebook',
    stateHash: sha256Hex(state),
    codeVerifierEnc: encrypt('n/a', ctx.env.encryptionKey),
    scopes: FACEBOOK_ALL_SCOPES,
    redirectUri: client.redirectUri,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  await audit(ctx, 'integration.oauth.start', { type: 'provider', id: 'facebook' }, undefined, {
    scopes: FACEBOOK_ALL_SCOPES,
  });
  return {
    status: 'REDIRECT' as const,
    authorizeUrl: buildFacebookAuthUrl({ client, scopes: FACEBOOK_ALL_SCOPES, state }),
    steps: [] as string[],
  };
}

/**
 * Callback: exchange the code, read the Pages the owner granted and store one connection per Page with its own
 * encrypted Page token. The user token is discarded. Reconnecting updates the existing row (never a duplicate).
 */
export async function completeFacebookOAuth(
  db: Db,
  env: ServiceEnv,
  st: typeof oauthStates.$inferSelect,
  code: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const client = clientFor(env);
  const cctx = connectorContext(db, env, null, overrides);
  const { userToken, granted, declined } = await exchangeFacebookCode(cctx, client, code);
  const pages = await listFacebookPages(cctx, client, userToken);
  if (!pages.length)
    throw badRequest(
      'Facebook returned no Pages. Run Connect again and tick the Page(s) you want CreatorOS to read.',
      undefined,
      'NO_PAGES',
    );
  const existingAll = await db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.orgId, st.orgId), eq(providerConnections.provider, 'facebook')));
  const nowIso = new Date().toISOString();
  const connected: { connectionId: string; pageId: string; pageName: string }[] = [];
  for (const p of pages) {
    const existing = existingAll.find((c) => c.principalHint === p.id);
    const values = {
      label: p.name,
      principalHint: p.id,
      encryptedTokenRef: encryptJson({ accessToken: p.pageToken, principal: p.id }, env.encryptionKey),
      scopes: granted,
      expiresAt: null,
      state: 'ACTIVE' as const,
      lastError: null,
      config: {
        ...((existing?.config as Record<string, unknown>) ?? {}),
        username: p.name,
        pageName: p.name,
        category: p.category,
        tasks: p.tasks,
        profilePictureUrl: p.pictureUrl,
        link: p.link,
        declinedPermissions: declined,
        issuedAt: nowIso,
        lastCheckAt: nowIso,
      },
      updatedAt: new Date(),
    };
    let id: string;
    if (existing) {
      await db.update(providerConnections).set(values).where(eq(providerConnections.id, existing.id));
      id = existing.id;
    } else {
      const [c] = await db
        .insert(providerConnections)
        .values({ orgId: st.orgId, provider: 'facebook', ...values })
        .returning({ id: providerConnections.id });
      id = c!.id;
    }
    await audit(
      { db, orgId: st.orgId, actor: { type: 'user', id: st.userId }, userId: st.userId },
      existing ? 'integration.reconnected' : 'integration.connected',
      { type: 'provider_connection', id },
      undefined,
      { provider: 'facebook', pageId: p.id, scopes: granted },
    );
    const sys = systemCtx({ db, env }, st.orgId);
    await autoReconcileConnection(sys, id).catch(() => null);
    await subscribeFacebookPageWebhooks(sys, id, overrides).catch(() => null);
    connected.push({ connectionId: id, pageId: p.id, pageName: p.name });
  }
  return {
    connectionId: connected[0]!.connectionId,
    provider: 'facebook' as const,
    principal: connected[0]!.pageId,
    pages: connected,
  };
}

async function loadFb(db: Db, orgId: string, id: string): Promise<Conn> {
  const [c] = await db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, id), eq(providerConnections.orgId, orgId)));
  if (!c || c.provider !== 'facebook') throw notFound('Facebook Page');
  return c;
}

/** Subscribes the Page to messages and feed webhooks (only changes which events Meta sends; nothing is posted or sent). */
export async function subscribeFacebookPageWebhooks(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const conn = await loadFb(ctx.db, ctx.orgId, connectionId);
  const client = clientFor(ctx.env);
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  let result: { subscribed: string[]; missing: string[]; error: string | null };
  try {
    result = { ...(await subscribeFacebookPage(cctx, client, conn.principalHint!)), error: null };
  } catch (e) {
    result = { subscribed: [], missing: [], error: (e as Error).message.slice(0, 300) };
  }
  await ctx.db
    .update(providerConnections)
    .set({
      config: { ...(conn.config as object), webhook: { ...result, at: new Date().toISOString() } },
      updatedAt: new Date(),
    })
    .where(eq(providerConnections.id, conn.id));
  await audit(ctx, 'social.webhook_subscribe', { type: 'provider_connection', id: conn.id }, undefined, {
    ok: !result.error && result.missing.length === 0,
    provider: 'facebook',
  });
  return result;
}

// ------------------------------------------------------------------ sync (read-only)

const MAX_PAGES = 4;
const MAX_COMMENT_MEDIA = 30;

/**
 * Pulls the Page's Messenger conversations, recent posts and post comments into the shared inbox tables.
 * Everything imported is historical (isLive false): stored and searchable, never triggers a workflow. Idempotent.
 */
export async function syncFacebookPage(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const conn = await loadFb(ctx.db, ctx.orgId, connectionId);
  if (conn.state !== 'ACTIVE' && conn.state !== 'PARTIAL_SYNC')
    throw new AppError(409, 'NEEDS_RECONNECT', 'Reconnect this Page before syncing.');
  const client = clientFor(ctx.env);
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  const pageId = conn.principalHint!;
  const granted = conn.scopes ?? [];
  const steps: { key: string; ok: boolean; fetched: number; error?: string; note?: string }[] = [];
  const counts = { posts: 0, comments: 0, conversations: 0, messages: 0, newMessages: 0 };
  const started = new Date().toISOString();

  const run = async (key: string, scope: string, fn: () => Promise<number>) => {
    if (!granted.includes(scope)) {
      steps.push({
        key,
        ok: false,
        fetched: 0,
        error: `Permission not granted: ${scope}. Reconnect and approve it.`,
      });
      return;
    }
    try {
      steps.push({ key, ok: true, fetched: await fn() });
    } catch (e) {
      steps.push({ key, ok: false, fetched: 0, error: (e as Error).message.slice(0, 300) });
    }
  };

  await run('posts', FACEBOOK_SCOPES.readEngagement, async () => {
    let after: string | null = null;
    let n = 0;
    for (let i = 0; i < MAX_PAGES; i++) {
      const p = await listFacebookPostsPage(cctx, client, pageId, { after });
      for (const m of p.items) {
        n += 1;
        await ctx.db
          .insert(socialMediaItems)
          .values({
            orgId: ctx.orgId,
            connectionId: conn.id,
            providerMediaId: m.id,
            mediaType: 'POST',
            caption: m.message,
            permalink: m.permalink,
            thumbnailUrl: m.thumbnailUrl,
            postedAt: m.createdTime ? new Date(m.createdTime) : null,
            commentsCount: m.commentsCount,
          })
          .onConflictDoUpdate({
            target: [socialMediaItems.connectionId, socialMediaItems.providerMediaId],
            set: {
              caption: m.message,
              permalink: m.permalink,
              thumbnailUrl: m.thumbnailUrl,
              commentsCount: m.commentsCount,
              lastSyncedAt: new Date(),
            },
          });
      }
      after = p.after;
      if (!after) break;
    }
    counts.posts = n;
    return n;
  });

  await run('comments', FACEBOOK_SCOPES.readContent, async () => {
    const due = rowsOf<{ id: string; provider_media_id: string; comments_count: number }>(
      await ctx.db.execute(sql`
        select id, provider_media_id, comments_count from social_media_items
        where connection_id = ${conn.id} and comments_count > 0
          and (comments_synced_count is null or comments_synced_count <> comments_count)
        order by posted_at desc nulls last limit ${MAX_COMMENT_MEDIA}`),
    );
    let n = 0;
    for (const m of due) {
      const before = n;
      let after: string | null = null;
      let finished = false;
      for (let i = 0; i < 20; i++) {
        const p = await listFacebookCommentsPage(cctx, client, m.provider_media_id, { after });
        for (const c of p.items) {
          n += 1;
          await ingestSocialEvent(ctx, {
            connectionId: conn.id,
            kind: 'COMMENT',
            providerThreadId: `comment:${c.rootId}`,
            providerMsgId: c.id,
            participantId: c.fromId ?? 'unknown',
            participantName: c.fromName,
            direction: c.fromId === pageId ? 'OUTBOUND' : 'INBOUND',
            text: c.text,
            mediaId: m.provider_media_id,
            receivedAt: new Date(c.createdTime),
            isLive: false,
          });
        }
        after = p.after;
        if (!after) {
          finished = true;
          break;
        }
      }
      // only mark a post as read once its list ended and it returned something
      if (finished && n > before)
        await ctx.db
          .update(socialMediaItems)
          .set({ commentsSyncedCount: m.comments_count })
          .where(eq(socialMediaItems.id, m.id));
    }
    counts.comments = n;
    return n;
  });

  await run('conversations', FACEBOOK_SCOPES.messaging, async () => {
    let after: string | null = null;
    let n = 0;
    for (let i = 0; i < MAX_PAGES; i++) {
      const p = await listFacebookConversationPage(cctx, client, pageId, { after });
      for (const c of p.conversations) {
        counts.conversations += 1;
        for (const m of c.messages) {
          n += 1;
          const r = await ingestSocialEvent(ctx, {
            connectionId: conn.id,
            kind: 'DM',
            providerThreadId: `dm:${m.participantId}`,
            providerMsgId: m.providerMsgId,
            participantId: m.participantId,
            participantName: m.participantName,
            direction: m.direction,
            text: m.text,
            hasMedia: m.hasMedia,
            receivedAt: new Date(m.receivedAt),
            isLive: false,
          });
          if (!r.duplicate) counts.newMessages += 1;
        }
      }
      after = p.after;
      if (!after) break;
    }
    counts.messages = n;
    return n;
  });

  const failed = steps.filter((s) => !s.ok);
  const state = failed.length === 0 ? 'OK' : failed.length === steps.length ? 'FAILED' : 'PARTIAL';
  const sync = {
    state,
    steps,
    counts,
    lastError: failed.map((s) => `${s.key}: ${s.error}`).join(' | ') || null,
    lastAttemptAt: started,
    ...(state !== 'FAILED' ? { lastSuccessAt: new Date().toISOString() } : {}),
  };
  const [fresh] = await ctx.db.select().from(providerConnections).where(eq(providerConnections.id, conn.id));
  const cfg = (fresh?.config ?? {}) as any;
  await ctx.db
    .update(providerConnections)
    .set({
      config: { ...cfg, social: { ...(cfg.social ?? {}), sync: { ...(cfg.social?.sync ?? {}), ...sync } } },
      lastSyncAt: state === 'FAILED' ? fresh?.lastSyncAt : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(providerConnections.id, conn.id));
  return sync;
}

/** One entry point for "Sync now" and the worker: picks the right importer for the connection's provider. */
export async function syncSocialAccount(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const [c] = await ctx.db
    .select({ provider: providerConnections.provider })
    .from(providerConnections)
    .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.orgId, ctx.orgId)));
  if (!c) throw notFound('Social account');
  return c.provider === 'facebook'
    ? syncFacebookPage(ctx, connectionId, overrides)
    : syncInstagramAccount(ctx, connectionId, overrides);
}

/** Read-only check that the stored Page token still works. Nothing is changed except the recorded check time. */
export async function testFacebookPage(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const conn = await loadFb(ctx.db, ctx.orgId, connectionId);
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  try {
    const page = await fetchFacebookPage(cctx, clientFor(ctx.env), conn.principalHint!);
    await ctx.db
      .update(providerConnections)
      .set({ state: 'ACTIVE', lastError: null, updatedAt: new Date() })
      .where(eq(providerConnections.id, conn.id));
    return { ok: true, page };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await ctx.db
      .update(providerConnections)
      .set({ state: 'AUTH_EXPIRED', lastError: msg, updatedAt: new Date() })
      .where(eq(providerConnections.id, conn.id));
    return { ok: false, error: msg };
  }
}

// ------------------------------------------------------------------ webhooks

/** POST delivery for object "page": authenticate the raw bytes with the PARENT app secret and store each entry once. */
export async function receiveFacebookWebhook(
  db: Db,
  env: ServiceEnv,
  raw: string | Buffer,
  signature: string | undefined,
) {
  const client = readFacebookClientConfig({ ...env.processEnv, APP_BASE_URL: env.appBaseUrl });
  if (!client) throw new AppError(404, 'NOT_CONFIGURED', 'Facebook app secret is not configured.');
  if (Buffer.byteLength(raw) > 256 * 1024)
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Webhook payload too large.');
  if (!verifyMetaSignature(raw, signature, client.appSecret))
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid webhook signature.');
  let body: any;
  try {
    body = JSON.parse(raw.toString());
  } catch {
    throw badRequest('Webhook body is not valid JSON.');
  }
  const entries: any[] = Array.isArray(body?.entry) ? body.entry.slice(0, 100) : [];
  let stored = 0;
  for (const entry of entries) {
    const dedupeKey = sha256Hex(JSON.stringify(entry));
    const res = await db
      .insert(providerWebhookEvents)
      .values({
        provider: 'facebook',
        dedupeKey,
        objectType: typeof body.object === 'string' ? body.object : null,
        payload: { object: body.object ?? null, entry },
      })
      .onConflictDoNothing()
      .returning({ id: providerWebhookEvents.id });
    if (res.length) stored += 1;
  }
  return { received: entries.length, stored, duplicates: entries.length - stored };
}

const LIVE_WINDOW_MS = 10 * 60_000;

/** Processes stored Page events into the inbox for the connected Page only; unknown Pages are IGNORED, never guessed. */
export async function processFacebookWebhookEvents(
  db: Db,
  env: ServiceEnv,
  overrides: Partial<ConnectorContext> = {},
  limit = 50,
) {
  const claimed = rowsOf<{ id: string; payload: any }>(
    await db.execute(sql`
      update provider_webhook_events set status = 'PROCESSING', processed_at = now()
      where id in (
        select id from provider_webhook_events
        where provider = 'facebook' and (status = 'PENDING' or (status = 'PROCESSING' and processed_at < now() - interval '5 minutes'))
        order by received_at limit ${limit} for update skip locked)
      returning id, payload`),
  );
  const out = { processed: 0, ignored: 0, failed: 0 };
  for (const row of claimed) {
    try {
      const events = parseFacebookWebhookEntry(row.payload?.entry);
      let handled = 0;
      for (const e of events) {
        const conns = await db
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.provider, 'facebook'),
              eq(providerConnections.principalHint, e.accountId),
              sql`${providerConnections.encryptedTokenRef} is not null`,
            ),
          );
        for (const conn of conns) {
          await processSocialEvent(
            db,
            env,
            conn.orgId,
            {
              connectionId: conn.id,
              kind: e.kind,
              providerThreadId: e.providerThreadId,
              providerMsgId: e.providerMsgId,
              participantId: e.participantId,
              participantName: e.participantName,
              direction: e.direction,
              text: e.text,
              hasMedia: e.hasMedia,
              mediaId: e.mediaId,
              receivedAt: e.receivedAt,
              isLive: Date.now() - e.receivedAt.getTime() < LIVE_WINDOW_MS,
            },
            overrides,
          );
          handled += 1;
        }
      }
      await db
        .update(providerWebhookEvents)
        .set({
          status: handled ? 'PROCESSED' : 'IGNORED',
          error: handled
            ? null
            : events.length
              ? 'no connected Page for this event'
              : 'no supported message or comment in this event',
          processedAt: new Date(),
        })
        .where(eq(providerWebhookEvents.id, row.id));
      out[handled ? 'processed' : 'ignored'] += 1;
    } catch (e) {
      await db
        .update(providerWebhookEvents)
        .set({ status: 'FAILED', error: (e as Error).message.slice(0, 300), processedAt: new Date() })
        .where(eq(providerWebhookEvents.id, row.id));
      out.failed += 1;
    }
  }
  return out;
}
