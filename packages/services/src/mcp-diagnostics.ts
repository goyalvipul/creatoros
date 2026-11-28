import { sql, type Executor } from '@creatoros/db';
import { decrypt } from './crypto';
import { sendMcpWebhook } from './mcp-event-webhook';

export const DIAGNOSTIC_EVENT = 'kemokem.diagnostic.requested';
export const DIAGNOSTIC_SUBSCRIBE = 'diagnostics.subscribe';
export const DIAGNOSTIC_RESULT = 'diagnostics.result';

type Delivery = {
  id: string;
  subscription_id: string;
  created_at: Date;
  attempts: number;
  message: string;
  callback_enc: string;
  secret_enc: string;
};

export async function dispatchMcpDiagnostics(db: Executor, key: Buffer) {
  await db.execute(
    sql`delete from mcp_diagnostic_site_calls where created_at < now() - interval '5 minutes'`,
  );
  await db.execute(sql`
    update mcp_diagnostic_subscriptions s
    set revoked_at = now(), callback_enc = null, secret_enc = null
    where revoked_at is null and not exists (
      select 1 from ai_gateway_connections g
      join organization_memberships m on m.org_id = g.org_id and m.user_id = g.hosted_owner
      join users u on u.id = m.user_id
      where g.org_id = s.org_id and g.enabled and g.mode = 'hosted'
        and g.hosted_hash = s.credential_hash and g.hosted_owner = s.owner_id
        and ${DIAGNOSTIC_SUBSCRIBE} = any(g.hosted_scopes) and ${DIAGNOSTIC_RESULT} = any(g.hosted_scopes)
        and m.role = 'OWNER' and m.status = 'ACTIVE' and u.status = 'ACTIVE'
    )
  `);
  await db.execute(sql`
    update mcp_diagnostic_subscriptions set callback_enc = null, secret_enc = null
    where expires_at <= now() and secret_enc is not null
  `);
  await db.execute(sql`
    update mcp_diagnostic_requests r
    set failed_at = now(), error_code = case
      when r.delivered_at is not null then 'acknowledgement_timeout'
      when r.attempts >= 4 then 'delivery_attempts_exhausted'
      else 'subscription_inactive' end
    from mcp_diagnostic_subscriptions s
    where s.id = r.subscription_id and r.completed_at is null and r.failed_at is null
      and ((r.delivered_at is null and r.next_attempt_at <= now()
            and (r.attempts >= 4 or s.revoked_at is not null or s.expires_at <= now()))
        or r.delivered_at < now() - interval '30 minutes')
  `);
  const result = await db.execute(sql`
    with next as (
      select r.id, s.callback_enc, s.secret_enc
      from mcp_diagnostic_requests r join mcp_diagnostic_subscriptions s on s.id = r.subscription_id
      where r.delivered_at is null and r.completed_at is null and r.failed_at is null
        and r.next_attempt_at <= now() and r.attempts < 4
        and s.revoked_at is null and s.expires_at > now()
        and exists (
          select 1 from ai_gateway_connections g
          join organization_memberships m on m.org_id = g.org_id and m.user_id = g.hosted_owner
          join users u on u.id = m.user_id
          where g.org_id = r.org_id and g.enabled and g.mode = 'hosted'
            and g.hosted_hash = r.credential_hash and g.hosted_owner = r.owner_id
            and ${DIAGNOSTIC_SUBSCRIBE} = any(g.hosted_scopes) and ${DIAGNOSTIC_RESULT} = any(g.hosted_scopes)
            and m.role = 'OWNER' and m.status = 'ACTIVE' and u.status = 'ACTIVE'
        )
      order by r.next_attempt_at limit 1
      for update of r skip locked
    )
    update mcp_diagnostic_requests r
    set dispatched_at = now(), attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
    from next where next.id = r.id
    returning r.id, r.subscription_id, r.created_at, r.attempts, r.message, next.callback_enc, next.secret_enc
  `);
  const [delivery] = (result as unknown as { rows: Delivery[] }).rows;
  if (!delivery) return { dispatched: false };
  const { id, subscription_id: subscriptionId, created_at: createdAt, attempts, message } = delivery;
  let status: number | null = null;
  let errorCode: string | null = null;
  let retry = false;
  try {
    const response = await sendMcpWebhook(
      decrypt(delivery.callback_enc, key),
      subscriptionId,
      decrypt(delivery.secret_enc, key),
      id,
      {
        eventId: id,
        name: DIAGNOSTIC_EVENT,
        timestamp: new Date(createdAt).toISOString(),
        data: { requestId: id, message },
        cursor: null,
      },
    );
    status = response.status;
    if (status < 200 || status >= 300) {
      errorCode = 'callback_http_error';
      retry = status === 429 || status >= 500;
    }
  } catch {
    errorCode = 'callback_transport_error';
    retry = true;
  }
  const failed = errorCode !== null && (!retry || attempts >= 4);
  await db.execute(sql`
    update mcp_diagnostic_requests
    set delivered_at = case when ${errorCode}::text is null then now() else delivered_at end,
        http_status = ${status},
        error_code = case when completed_at is null then ${errorCode} else null end,
        failed_at = case when ${failed} and completed_at is null then now() else failed_at end,
        next_attempt_at = now() + (${attempts} * interval '30 seconds')
    where id = ${id} and attempts = ${attempts}
  `);
  return { dispatched: true };
}
