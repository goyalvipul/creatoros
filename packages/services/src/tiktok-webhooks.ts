import { createHash } from 'node:crypto';
import {
  and,
  eq,
  or,
  providerConnections,
  providerWebhookEvents,
  publicationRecords,
  sql,
  syncCursors,
  type Db,
} from '@creatoros/db';
import { verifyTikTokSignature } from '@creatoros/connectors';
import { AppError, badRequest, type ServiceEnv } from './types';

export const TIKTOK_WEBHOOK_MAX_BYTES = 256 * 1024;

const SECRET_KEY = /token|secret|password|authorization|cookie/i;

const REMOVED_REASON: Record<number, string> = {
  0: 'TikTok removed this app authorization (reason unknown).',
  1: 'The TikTok account owner disconnected this app.',
  2: 'The TikTok account was deleted.',
  3: 'The TikTok account holder no longer meets the age requirement.',
  4: 'The TikTok account was banned.',
  5: 'The developer revoked this TikTok authorization.',
};

const PUBLISH_EVENTS = new Set([
  'post.publish.failed',
  'post.publish.complete',
  'post.publish.inbox_delivered',
  'post.publish.publicly_available',
  'post.publish.no_longer_publicaly_available',
  'video.upload.failed',
  'video.publish.completed',
]);

const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? r : ((r as { rows?: T[] })?.rows ?? [])) as T[];

function clientSecret(env: ServiceEnv): string | undefined {
  const value = env.processEnv.TIKTOK_CLIENT_SECRET?.trim();
  return value || undefined;
}

/** Drops keys that could hold a credential. Values are shortened. The client secret is never stored. */
export function sanitizeTikTokValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeTikTokValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = sanitizeTikTokValue(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return null;
}

function parseContent(content: unknown): Record<string, unknown> {
  if (content && typeof content === 'object' && !Array.isArray(content))
    return sanitizeTikTokValue(content) as Record<string, unknown>;
  if (typeof content !== 'string' || !content) return {};
  try {
    const parsed = JSON.parse(content) as unknown;
    return (sanitizeTikTokValue(parsed) as Record<string, unknown>) ?? {};
  } catch {
    return { unparsed: true };
  }
}

export function tiktokWebhookPayload(body: unknown): {
  event: string;
  createTime: number | null;
  userOpenId: string;
  content: Record<string, unknown>;
} {
  const row = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const event = typeof row.event === 'string' ? row.event.slice(0, 120) : '';
  const createTime = typeof row.create_time === 'number' ? row.create_time : null;
  const userOpenId = typeof row.user_openid === 'string' ? row.user_openid.slice(0, 200) : '';
  return { event, createTime, userOpenId, content: parseContent(row.content) };
}

/**
 * Verifies `TikTok-Signature` over the raw body, stores one sanitized row, and returns.
 * The worker applies the event. A repeated body is acknowledged again and not stored twice.
 */
export async function receiveTikTokWebhook(
  db: Db,
  env: ServiceEnv,
  raw: string | Buffer,
  signature: string | undefined,
  nowMs = Date.now(),
): Promise<{ received: number; stored: number; duplicates: number }> {
  const secret = clientSecret(env);
  if (!secret)
    throw new AppError(
      404,
      'NOT_CONFIGURED',
      'TikTok webhooks are not configured (TIKTOK_CLIENT_SECRET).',
    );
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  if (!text) throw badRequest('Empty webhook body.');
  if (Buffer.byteLength(text) > TIKTOK_WEBHOOK_MAX_BYTES) throw badRequest('Webhook body is too large.');
  if (!verifyTikTokSignature(secret, text, signature, nowMs))
    throw new AppError(401, 'UNAUTHORIZED', 'TikTok signature was rejected.');
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw badRequest('Webhook body is not JSON.');
  }
  const payload = tiktokWebhookPayload(body);
  if (!payload.event) throw badRequest('Webhook event name is missing.');
  const dedupeKey = createHash('sha256').update(text).digest('hex');
  const inserted = await db
    .insert(providerWebhookEvents)
    .values({
      provider: 'tiktok',
      dedupeKey,
      objectType: payload.event,
      payload: {
        event: payload.event,
        create_time: payload.createTime,
        user_openid: payload.userOpenId,
        content: payload.content,
      },
    })
    .onConflictDoNothing()
    .returning({ id: providerWebhookEvents.id });
  const stored = inserted.length;
  return { received: 1, stored, duplicates: stored ? 0 : 1 };
}

async function mark(
  db: Db,
  id: string,
  status: 'PROCESSED' | 'IGNORED' | 'FAILED',
  error: string | null,
) {
  await db
    .update(providerWebhookEvents)
    .set({ status, processedAt: new Date(), error })
    .where(eq(providerWebhookEvents.id, id));
}

async function applyTikTokEvent(db: Db, payload: ReturnType<typeof tiktokWebhookPayload>): Promise<'processed' | 'ignored'> {
  if (payload.event === 'authorization.removed') {
    if (!payload.userOpenId) return 'ignored';
    const reason = Number(payload.content.reason);
    const note = REMOVED_REASON[reason] ?? REMOVED_REASON[0]!;
    const cleared = await db
      .update(providerConnections)
      .set({
        encryptedTokenRef: null,
        state: 'AUTH_EXPIRED',
        lastError: note,
        updatedAt: new Date(),
      })
      .where(and(eq(providerConnections.provider, 'tiktok'), eq(providerConnections.principalHint, payload.userOpenId)))
      .returning({ id: providerConnections.id });
    if (!cleared.length) return 'ignored';
    for (const row of cleared)
      await db.delete(syncCursors).where(eq(syncCursors.connectionId, row.id));
    return 'processed';
  }
  if (!PUBLISH_EVENTS.has(payload.event)) return 'ignored';
  const publishId = typeof payload.content.publish_id === 'string' ? payload.content.publish_id : '';
  const shareId = typeof payload.content.share_id === 'string' ? payload.content.share_id : '';
  const ids = [publishId, shareId].filter(Boolean);
  if (!ids.length) return 'ignored';
  const matched = await db
    .select({ id: publicationRecords.id, state: publicationRecords.state, externalPostId: publicationRecords.externalPostId })
    .from(publicationRecords)
    .where(
      and(
        eq(publicationRecords.provider, 'tiktok'),
        or(...ids.map((id) => eq(publicationRecords.externalPostId, id))),
      ),
    );
  if (!matched.length) return 'ignored';
  const failed = payload.event === 'post.publish.failed' || payload.event === 'video.upload.failed';
  const removed = payload.event === 'post.publish.no_longer_publicaly_available';
  const failReason =
    typeof payload.content.fail_reason === 'string' ? payload.content.fail_reason.slice(0, 500) : null;
  for (const row of matched) {
    const nextState = failed ? 'FAILED' : removed ? 'REMOVED' : row.state;
    await db
      .update(publicationRecords)
      .set({
        state: nextState,
        stateProvenance: failed || removed ? 'VERIFIED_PLATFORM' : undefined,
        stateEvidence: payload.event,
        failureReason: failed ? failReason : undefined,
        externalPostId: row.externalPostId || shareId || publishId,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(publicationRecords.id, row.id));
  }
  return 'processed';
}

/** Applies stored TikTok events. A handler error is recorded on the row and does not fail the whole batch. */
export async function processTikTokWebhookEvents(db: Db, limit = 50) {
  const claimed = rowsOf<{ id: string; payload: unknown }>(
    await db.execute(sql`
      update provider_webhook_events set status = 'PROCESSING', processed_at = now()
      where id in (
        select id from provider_webhook_events
        where provider = 'tiktok' and (status = 'PENDING' or (status = 'PROCESSING' and processed_at < now() - interval '5 minutes'))
        order by received_at limit ${limit} for update skip locked)
      returning id, payload`),
  );
  const out = { processed: 0, ignored: 0, failed: 0 };
  for (const row of claimed) {
    try {
      const payload = tiktokWebhookPayload(row.payload);
      const result = await applyTikTokEvent(db, payload);
      await mark(db, row.id, result === 'processed' ? 'PROCESSED' : 'IGNORED', null);
      if (result === 'processed') out.processed += 1;
      else out.ignored += 1;
    } catch {
      out.failed += 1;
      await mark(db, row.id, 'FAILED', 'HANDLER_FAILED').catch(() => undefined);
    }
  }
  return out;
}
