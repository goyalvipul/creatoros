import { sql, type Db } from '@creatoros/db';
import { lockScreenText, safeNotificationPath } from '@creatoros/domain';
import webpush from 'web-push';
import { decryptJson, encryptJson, sha256Hex } from './crypto';
import { actionBadgeCount, notify } from './notifications';
import { badRequest, type Ctx, type ServiceEnv } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

type StoredSub = { endpoint: string; keys: { p256dh: string; auth: string } };

function vapid(env: ServiceEnv) {
  const publicKey = env.processEnv.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.processEnv.VAPID_PRIVATE_KEY?.trim();
  const subject = env.processEnv.VAPID_SUBJECT?.trim() || 'mailto:privacy@kemokem.com';
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function pushPublicKey(env: ServiceEnv) {
  return vapid(env)?.publicKey ?? null;
}

export async function savePushSubscription(
  ctx: Ctx,
  input: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string | null; label?: string | null },
) {
  let url: URL;
  try {
    url = new URL(input.endpoint);
  } catch {
    throw badRequest('That push address is not a URL');
  }
  if (url.protocol !== 'https:' || input.endpoint.length > 2000) throw badRequest('Push only uses an https address');
  if (!input.keys?.p256dh || !input.keys?.auth) throw badRequest('This browser did not send push keys');
  const hash = sha256Hex(input.endpoint);
  const secret = encryptJson({ endpoint: input.endpoint, keys: input.keys } satisfies StoredSub, ctx.env.encryptionKey);
  const label = (input.label?.trim() || input.userAgent || 'This browser').slice(0, 200);
  await ctx.db.execute(sql`
    insert into push_subscriptions (org_id, user_id, endpoint_hash, secret_ref, user_agent, revoked_at, updated_at)
    values (${ctx.orgId}::uuid, ${ctx.userId}::uuid, ${hash}, ${secret}, ${label}, null, now())
    on conflict (endpoint_hash) do update set
      org_id = excluded.org_id,
      user_id = excluded.user_id,
      secret_ref = excluded.secret_ref,
      user_agent = excluded.user_agent,
      revoked_at = null,
      last_error = null,
      updated_at = now()
  `);
  return { saved: true };
}

export async function listPushSubscriptions(ctx: Ctx) {
  return rowsOf<{
    id: string;
    userAgent: string | null;
    createdAt: string;
    revokedAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  }>(
    await ctx.db.execute(sql`
      select id, user_agent as "userAgent", created_at as "createdAt", revoked_at as "revokedAt",
             last_success_at as "lastSuccessAt", last_error as "lastError"
      from push_subscriptions
      where org_id = ${ctx.orgId}::uuid and user_id = ${ctx.userId}::uuid
      order by created_at desc
      limit 20
    `),
  );
}

export async function revokePushSubscriptionByEndpoint(ctx: Ctx, endpoint: string) {
  const hash = sha256Hex(endpoint);
  const r = await ctx.db.execute(sql`
    update push_subscriptions set revoked_at = now(), updated_at = now()
    where endpoint_hash = ${hash} and org_id = ${ctx.orgId}::uuid and user_id = ${ctx.userId}::uuid and revoked_at is null
  `);
  return { updated: (r as { rowCount?: number }).rowCount ?? 0 };
}

export async function revokePushSubscription(ctx: Ctx, id: string) {
  const r = await ctx.db.execute(sql`
    update push_subscriptions set revoked_at = now(), updated_at = now()
    where id = ${id}::uuid and org_id = ${ctx.orgId}::uuid and user_id = ${ctx.userId}::uuid and revoked_at is null
  `);
  return { updated: (r as { rowCount?: number }).rowCount ?? 0 };
}

/** Saves an in-app row and queues push for this user's active devices, even when the category is in-app only. */
export async function sendTestNotification(ctx: Ctx) {
  const saved = await notify(ctx.db, {
    orgId: ctx.orgId,
    userId: ctx.userId,
    type: 'system.test',
    dedupeKey: `system.test:${ctx.userId}:${new Date().toISOString().slice(0, 16)}`,
    title: 'Kemokem test',
    body: 'This is a test from Settings. The lock screen uses a shorter line.',
    deepLink: '/notifications',
  });
  await ctx.db.execute(sql`
    insert into notification_deliveries (org_id, notification_id, subscription_id, channel, next_attempt_at)
    select n.org_id, n.id, s.id, 'push', now()
    from notifications n
    join push_subscriptions s on s.org_id = n.org_id and s.user_id = ${ctx.userId}::uuid and s.revoked_at is null
    where n.org_id = ${ctx.orgId}::uuid and n.user_id = ${ctx.userId}::uuid and n.type = 'system.test'
    order by n.created_at desc
    limit 20
    on conflict (notification_id, subscription_id) do nothing
  `);
  const devices = await listPushSubscriptions(ctx);
  const active = devices.filter((d) => !d.revokedAt).length;
  return {
    saved,
    devices: active,
    push: active > 0 ? 'queued' : 'no device is subscribed',
  };
}

/**
 * Hands queued rows to the browser push service.
 * `sent` means the service accepted the message. It does not mean the person opened it.
 */
export async function deliverQueuedPushes(db: Db, env: ServiceEnv): Promise<{ sent: number; failed: number; skipped?: string }> {
  await db.execute(sql`
    update notification_deliveries
    set state = 'RETRY'
    where state = 'SENDING' and next_attempt_at < now() - interval '10 minutes'
  `);
  const keys = vapid(env);
  if (!keys) return { sent: 0, failed: 0, skipped: 'vapid' };
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  const due = rowsOf<{
    id: string;
    attempts: number;
    title: string;
    type: string;
    priority: string;
    deepLink: string | null;
    secretRef: string;
    subscriptionId: string;
    userId: string;
    orgId: string;
  }>(
    await db.execute(sql`
      with due as (
        select d.id
        from notification_deliveries d
        where d.state in ('PENDING', 'RETRY') and d.next_attempt_at <= now() and d.channel = 'push'
        order by d.next_attempt_at
        limit 20
        for update skip locked
      )
      update notification_deliveries d
      set state = 'SENDING', attempts = d.attempts + 1
      from due
      where d.id = due.id
      returning d.id, d.attempts, d.subscription_id as "subscriptionId"
    `),
  );
  if (!due.length) return { sent: 0, failed: 0 };
  const ids = due.map((d) => d.id);
  const full = rowsOf<{
    id: string;
    attempts: number;
    title: string;
    type: string;
    priority: string;
    deepLink: string | null;
    secretRef: string;
    subscriptionId: string;
    userId: string;
    orgId: string;
  }>(
    await db.execute(sql`
      select d.id, d.attempts, n.title, n.type, n.priority, n.deep_link as "deepLink", n.org_id as "orgId",
             s.secret_ref as "secretRef", s.id as "subscriptionId", s.user_id as "userId"
      from notification_deliveries d
      join notifications n on n.id = d.notification_id
      join push_subscriptions s on s.id = d.subscription_id
      where d.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
    `),
  );
  let sent = 0;
  let failed = 0;
  const badges = new Map<string, number>();
  for (const row of full) {
    const important = row.priority === 'high' || row.priority === 'urgent' || row.type === 'system.test';
    if (!important) {
      const routine = rowsOf<{ n: number }>(
        await db.execute(sql`
          select count(*)::int as n from notification_deliveries d
          join notifications n on n.id = d.notification_id
          join push_subscriptions s on s.id = d.subscription_id
          where s.user_id = ${row.userId}::uuid and d.sent_at > now() - interval '1 day'
            and n.priority = 'normal' and n.type <> 'system.test'
        `),
      )[0]?.n ?? 0;
      if (routine >= 12) {
        await db.execute(sql`
          update notification_deliveries
          set state = 'RETRY', last_error = 'waiting: 12 routine pushes already sent today', next_attempt_at = now() + interval '6 hours'
          where id = ${row.id}::uuid
        `);
        continue;
      }
    }
    const recent = rowsOf<{ n: number }>(
      await db.execute(sql`
        select count(*)::int as n from notification_deliveries d
        join push_subscriptions s on s.id = d.subscription_id
        where s.user_id = ${row.userId}::uuid and d.sent_at > now() - interval '1 hour'
      `),
    )[0]?.n ?? 0;
    if (recent >= 30) {
      await db.execute(sql`
        update notification_deliveries
        set state = 'RETRY', last_error = 'waiting: 30 pushes already sent this hour', next_attempt_at = now() + interval '1 hour'
        where id = ${row.id}::uuid
      `);
      continue;
    }
    let sub: StoredSub;
    try {
      sub = decryptJson<StoredSub>(row.secretRef, env.encryptionKey);
    } catch {
      await db.execute(sql`
        update notification_deliveries set state = 'DEAD', last_error = 'stored push keys could not be read' where id = ${row.id}::uuid
      `);
      failed += 1;
      continue;
    }
    if (!badges.has(row.userId)) badges.set(row.userId, await actionBadgeCount(db, row.orgId, row.userId));
    const urgent = row.priority === 'high' || row.priority === 'urgent';
    const payload = JSON.stringify({
      title: row.title.slice(0, 120),
      body: lockScreenText(row.type),
      url: safeNotificationPath(row.deepLink),
      tag: row.type,
      badge: badges.get(row.userId) ?? 0,
      id: row.id,
    });
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
        { TTL: urgent ? 60 * 60 * 4 : 60 * 60 * 12, urgency: urgent ? 'high' : 'normal' },
      );
      await db.execute(sql`
        update notification_deliveries set state = 'SENT', sent_at = now(), last_error = null where id = ${row.id}::uuid
      `);
      await db.execute(sql`
        update push_subscriptions set last_success_at = now(), last_error = null, updated_at = now() where id = ${row.subscriptionId}::uuid
      `);
      sent += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 0;
      const message = ((e as Error).message || 'push service refused the message').slice(0, 300);
      if (status === 404 || status === 410) {
        await db.execute(sql`
          update push_subscriptions set revoked_at = now(), last_error = 'the browser expired this subscription', updated_at = now()
          where id = ${row.subscriptionId}::uuid
        `);
        await db.execute(sql`
          update notification_deliveries set state = 'DEAD', last_error = 'subscription expired' where id = ${row.id}::uuid
        `);
      } else if (row.attempts >= 5) {
        await db.execute(sql`
          update notification_deliveries set state = 'DEAD', last_error = ${message} where id = ${row.id}::uuid
        `);
        await db.execute(sql`
          update push_subscriptions set last_error = ${message}, updated_at = now() where id = ${row.subscriptionId}::uuid
        `);
      } else {
        const minutes = Math.min(60, 2 ** row.attempts);
        await db.execute(sql`
          update notification_deliveries
          set state = 'RETRY', last_error = ${message}, next_attempt_at = now() + (${String(minutes)} || ' minutes')::interval
          where id = ${row.id}::uuid
        `);
        await db.execute(sql`
          update push_subscriptions set last_error = ${message}, updated_at = now() where id = ${row.subscriptionId}::uuid
        `);
      }
      failed += 1;
    }
  }
  return { sent, failed };
}
