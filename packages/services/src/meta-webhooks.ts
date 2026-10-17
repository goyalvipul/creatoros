import { createHash, timingSafeEqual } from 'node:crypto';
import { providerWebhookEvents, type Db } from '@creatoros/db';
import { readInstagramClientConfig, verifyMetaSignature } from '@creatoros/connectors';
import { AppError, badRequest, type ServiceEnv } from './types';

export const META_WEBHOOK_MAX_BYTES = 256 * 1024;

const safeEq = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};

/** GET handshake: Meta calls with hub.mode=subscribe, hub.verify_token and hub.challenge. Echo the challenge only on a match. */
export function verifyMetaHandshake(
  env: ServiceEnv,
  q: { mode?: string; verifyToken?: string; challenge?: string },
): string {
  const expected =
    readInstagramClientConfig(env.processEnv)?.webhookVerifyToken ?? env.processEnv.META_WEBHOOK_VERIFY_TOKEN;
  if (!expected)
    throw new AppError(
      404,
      'NOT_CONFIGURED',
      'Meta webhooks are not configured (META_WEBHOOK_VERIFY_TOKEN).',
    );
  if (q.mode !== 'subscribe' || !q.verifyToken || !q.challenge || !safeEq(q.verifyToken, expected))
    throw new AppError(403, 'FORBIDDEN', 'Webhook verification failed.');
  return q.challenge;
}

/**
 * POST delivery: authenticate the raw bytes with the app secret, enforce the size limit, store each event once
 * (dedupe key = sha256 of the entry) and return immediately. Processing is asynchronous (status PENDING).
 */
export async function receiveInstagramWebhook(
  db: Db,
  env: ServiceEnv,
  raw: string | Buffer,
  signature: string | undefined,
) {
  const secret = env.processEnv.INSTAGRAM_APP_SECRET;
  if (!secret) throw new AppError(404, 'NOT_CONFIGURED', 'Instagram app secret is not configured.');
  if (Buffer.byteLength(raw) > META_WEBHOOK_MAX_BYTES)
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Webhook payload too large.');
  if (!verifyMetaSignature(raw, signature, secret))
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid webhook signature.');
  let body: any;
  try {
    body = JSON.parse(raw.toString());
  } catch {
    throw badRequest('Webhook body is not valid JSON.');
  }
  const entries: any[] = Array.isArray(body?.entry) ? body.entry.slice(0, 100) : [];
  let stored = 0;
  let duplicates = 0;
  for (const entry of entries) {
    const dedupeKey = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
    const res = await db
      .insert(providerWebhookEvents)
      .values({
        provider: 'instagram',
        dedupeKey,
        objectType: typeof body.object === 'string' ? body.object : null,
        payload: { object: body.object ?? null, entry },
      })
      .onConflictDoNothing()
      .returning({ id: providerWebhookEvents.id });
    if (res.length) stored += 1;
    else duplicates += 1;
  }
  return { received: entries.length, stored, duplicates };
}
