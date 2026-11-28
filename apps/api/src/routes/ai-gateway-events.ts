import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql, type Executor } from '@creatoros/db';
import {
  badRequest,
  conflict,
  DIAGNOSTIC_EVENT,
  DIAGNOSTIC_RESULT,
  DIAGNOSTIC_SUBSCRIBE,
  decrypt,
  encrypt,
  forbidden,
  notFound,
  verifyMcpCallback,
  webhookKey,
  callbackUrl,
  type Ctx,
} from '@creatoros/services';
import { z } from 'zod';
import { makeRouter, type AppDeps } from '../http';

type Auth = { ctx: Ctx; hash: string; mode: 'hosted' | 'local'; scopes: string[] };
type Authenticator = (request: FastifyRequest) => Promise<Auth>;
const principal = z.string().trim().min(1).max(256);
const destination = z.string().max(2048);
const subscription = z.object({ principal, url: destination, secret: z.string().max(120) }).strict();
const unsubscribe = subscription.omit({ secret: true });
const acknowledgement = z.object({ principal, requestId: z.uuid() }).strict();
const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function checkConnection(db: Executor, auth: Auth) {
  const match = rows(
    await db.execute(sql`
    select g.org_id from ai_gateway_connections g
    join organization_memberships m on m.org_id = g.org_id and m.user_id = g.hosted_owner
    join users u on u.id = m.user_id
    where g.org_id = ${auth.ctx.orgId} and g.enabled and g.mode = 'hosted'
      and g.hosted_hash = ${auth.hash} and g.hosted_owner = ${auth.ctx.userId}
      and ${DIAGNOSTIC_SUBSCRIBE} = any(g.hosted_scopes)
      and ${DIAGNOSTIC_RESULT} = any(g.hosted_scopes)
      and m.role = 'OWNER' and m.status = 'ACTIVE' and u.status = 'ACTIVE'
    for update of g
  `),
  );
  if (!match.length) throw forbidden('Diagnostic authorization changed.');
}

function callback(value: string) {
  try {
    return callbackUrl(value).href;
  } catch {
    throw badRequest('Invalid callback URL.', undefined, 'MCP_CALLBACK_INVALID');
  }
}

export function registerGatewayEvents(
  app: FastifyInstance,
  deps: AppDeps,
  authenticate: Authenticator,
  envelope: (request: FastifyRequest, data: unknown) => unknown,
) {
  const route = makeRouter(app, deps);
  async function authorize(request: FastifyRequest, action: 'subscribe' | 'unsubscribe' | 'result') {
    const key = deps.config.env.processEnv?.KEMOKEM_MCP_EVENTS_KEY;
    const timestamp = request.headers['x-kemokem-event-time'];
    const nonce = request.headers['x-kemokem-event-nonce'];
    const signature = request.headers['x-kemokem-event-signature'];
    if (
      !key ||
      !/^[a-f0-9]{64}$/.test(key) ||
      typeof timestamp !== 'string' ||
      !/^\d{10}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 ||
      typeof nonce !== 'string' ||
      !z.uuid().safeParse(nonce).success ||
      typeof signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      throw forbidden('Verified Site event identity is required.');
    const body = JSON.stringify(request.body);
    const expected = createHmac('sha256', key).update(`${timestamp}.${nonce}.${action}.${body}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw forbidden('Verified Site event identity is required.');

    const auth = await authenticate(request);
    if (
      auth.mode !== 'hosted' ||
      !auth.scopes.includes(DIAGNOSTIC_SUBSCRIBE) ||
      !auth.scopes.includes(DIAGNOSTIC_RESULT)
    )
      throw forbidden('Hosted diagnostic permissions are required.');
    const claimed = rows(
      await auth.ctx.db.execute(sql`
      insert into mcp_diagnostic_site_calls (nonce)
      values (${nonce}) on conflict do nothing returning nonce
    `),
    );
    if (!claimed.length) throw conflict('Duplicate Site event request.');
    return auth;
  }

  app.post(
    '/ai-gateway/events/subscribe',
    { bodyLimit: 8192, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const auth = await authorize(req, 'subscribe');
      const input = subscription.parse(req.body);
      const url = callback(input.url);
      try {
        webhookKey(input.secret);
      } catch {
        throw badRequest('Invalid callback signing key.', undefined, 'MCP_CALLBACK_INVALID');
      }
      const { ctx, hash } = auth;
      const callbackHash = digest(url);
      // A replacement gateway credential starts a separate authorization lifecycle.
      const id = digest(
        JSON.stringify([ctx.orgId, ctx.userId, hash, input.principal, DIAGNOSTIC_EVENT, url]),
      );
      const [existing] = rows<{ secret_enc: string }>(
        await ctx.db.execute(sql`
      select secret_enc from mcp_diagnostic_subscriptions
      where id = ${id} and revoked_at is null and expires_at > now()
        and verified_at > now() - interval '24 hours'
    `),
      );
      const key = ctx.env.encryptionKey;
      const cached = existing && decrypt(existing.secret_enc, key) === input.secret;
      if (!cached) {
        try {
          await verifyMcpCallback(url, id, input.secret);
        } catch (error) {
          const reason =
            error instanceof Error && error.message === 'unsafe_callback_address'
              ? 'unsafe_callback_address'
              : error instanceof Error && error.name === 'TimeoutError'
                ? 'timeout'
                : 'challenge_failed';
          await ctx.db.execute(sql`
          insert into mcp_diagnostic_verification_errors(org_id, owner_id, code)
          values (${ctx.orgId}, ${ctx.userId}, ${reason})
          on conflict (org_id, owner_id) do update set code = excluded.code, failed_at = now()
        `);
          throw badRequest('Callback verification failed.', { reason }, 'MCP_CALLBACK_UNVERIFIED');
        }
      }
      const [saved] = await ctx.db.transaction(async (tx) => {
        await checkConnection(tx, auth);
        if (cached)
          return rows<{ expires_at: Date }>(
            await tx.execute(sql`
        update mcp_diagnostic_subscriptions set expires_at = now() + interval '1 hour'
        where id = ${id} and revoked_at is null and secret_enc = ${existing.secret_enc}
        returning expires_at
      `),
          );
        return rows<{ expires_at: Date }>(
          await tx.execute(sql`
        insert into mcp_diagnostic_subscriptions
          (id, org_id, owner_id, credential_hash, principal, callback_hash, callback_enc, secret_enc, verified_at, expires_at)
        values (${id}, ${ctx.orgId}, ${ctx.userId}, ${hash}, ${input.principal}, ${callbackHash},
                ${encrypt(url, key)}, ${encrypt(input.secret, key)}, now(), now() + interval '1 hour')
        on conflict (id) do update set callback_enc = excluded.callback_enc, secret_enc = excluded.secret_enc,
          verified_at = excluded.verified_at, expires_at = excluded.expires_at, revoked_at = null
        returning expires_at
      `),
        );
      });
      if (!saved) throw conflict('Subscription changed during refresh.');
      await ctx.db.execute(sql`
      delete from mcp_diagnostic_verification_errors where org_id = ${ctx.orgId} and owner_id = ${ctx.userId}
    `);
      return envelope(req, {
        id,
        refreshBefore: new Date(saved.expires_at).toISOString(),
        cursor: null,
        truncated: false,
      });
    },
  );

  app.post('/ai-gateway/events/unsubscribe', { bodyLimit: 8192 }, async (req) => {
    const auth = await authorize(req, 'unsubscribe');
    const input = unsubscribe.parse(req.body);
    const callbackHash = digest(callback(input.url));
    await auth.ctx.db.transaction(async (tx) => {
      await checkConnection(tx, auth);
      await tx.execute(sql`
        update mcp_diagnostic_subscriptions set revoked_at = now(), callback_enc = null, secret_enc = null
        where org_id = ${auth.ctx.orgId} and owner_id = ${auth.ctx.userId} and credential_hash = ${auth.hash}
          and principal = ${input.principal} and callback_hash = ${callbackHash} and revoked_at is null
      `);
    });
    return envelope(req, {});
  });

  app.post('/ai-gateway/events/result', { bodyLimit: 4096 }, async (req) => {
    const auth = await authorize(req, 'result');
    const input = acknowledgement.parse(req.body);
    const [saved] = await auth.ctx.db.transaction(async (tx) => {
      await checkConnection(tx, auth);
      return rows<{ id: string }>(
        await tx.execute(sql`
        update mcp_diagnostic_requests
        set acknowledged_at = coalesce(acknowledged_at, now()), completed_at = coalesce(completed_at, now()),
            failed_at = null, error_code = null
        where id = ${input.requestId} and org_id = ${auth.ctx.orgId} and owner_id = ${auth.ctx.userId}
          and credential_hash = ${auth.hash} and principal = ${input.principal} and dispatched_at is not null
        returning id
      `),
      );
    });
    if (!saved) throw notFound('Dispatched diagnostic');
    return envelope(req, { requestId: saved.id, completed: true });
  });

  route(
    {
      method: 'GET',
      url: '/integrations/ai-gateway/events',
      tag: 'AI Gateway',
      summary: 'Diagnostic event subscriptions and execution history',
      role: 'OWNER',
    },
    async ({ ctx, reply }) => {
      reply.header('cache-control', 'no-store');
      const [connection] = rows<{ enabled: boolean }>(
        await ctx.db.execute(sql`
      select enabled and mode = 'hosted' and hosted_hash is not null and hosted_owner = ${ctx.userId}
        and ${DIAGNOSTIC_SUBSCRIBE} = any(hosted_scopes) and ${DIAGNOSTIC_RESULT} = any(hosted_scopes) as enabled
      from ai_gateway_connections where org_id = ${ctx.orgId}
    `),
      );
      return {
        configured: /^[a-f0-9]{64}$/.test(ctx.env.processEnv?.KEMOKEM_MCP_EVENTS_KEY ?? ''),
        enabled: connection?.enabled === true,
        verificationError:
          rows(
            await ctx.db.execute(sql`
          select code, failed_at from mcp_diagnostic_verification_errors
          where org_id = ${ctx.orgId} and owner_id = ${ctx.userId}
        `),
          )[0] ?? null,
        subscriptions: rows(
          await ctx.db.execute(sql`
        select s.id, s.verified_at, s.expires_at, s.revoked_at,
          (select max(r.delivered_at) from mcp_diagnostic_requests r where r.subscription_id = s.id) as last_delivery,
          (select max(r.acknowledged_at) from mcp_diagnostic_requests r where r.subscription_id = s.id) as last_acknowledgement
        from mcp_diagnostic_subscriptions s where s.org_id = ${ctx.orgId} and s.owner_id = ${ctx.userId}
        order by s.expires_at desc limit 30
      `),
        ),
        history: rows(
          await ctx.db.execute(sql`
        select id, subscription_id, created_at, dispatched_at, delivered_at, acknowledged_at, completed_at,
          failed_at, error_code, http_status, attempts
        from mcp_diagnostic_requests where org_id = ${ctx.orgId} and owner_id = ${ctx.userId}
        order by created_at desc limit 30
      `),
        ),
      };
    },
  );

  route(
    {
      method: 'POST',
      url: '/integrations/ai-gateway/events/send',
      tag: 'AI Gateway',
      summary: 'Queue one diagnostic event',
      role: 'OWNER',
      rateLimit: { max: 10, timeWindow: '1 minute' },
      body: z.object({ subscriptionId: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.uuid() }).strict(),
    },
    async ({ ctx, body }) => {
      const id = body.requestId;
      const result = await ctx.db.execute(sql`
      insert into mcp_diagnostic_requests (id, subscription_id, org_id, owner_id, credential_hash, principal, message)
      select ${id}, s.id, s.org_id, s.owner_id, s.credential_hash, s.principal, 'Kemokem connector diagnostic'
      from mcp_diagnostic_subscriptions s join ai_gateway_connections g on g.org_id = s.org_id
      where s.id = ${body.subscriptionId} and s.org_id = ${ctx.orgId} and s.owner_id = ${ctx.userId}
        and s.expires_at > now() and s.revoked_at is null and g.enabled and g.mode = 'hosted'
        and g.hosted_hash = s.credential_hash and g.hosted_owner = s.owner_id
        and ${DIAGNOSTIC_SUBSCRIBE} = any(g.hosted_scopes) and ${DIAGNOSTIC_RESULT} = any(g.hosted_scopes)
      on conflict (id) do nothing
      returning id
    `);
      const replay =
        !rows(result).length &&
        rows(
          await ctx.db.execute(sql`
        select id from mcp_diagnostic_requests where id = ${id} and org_id = ${ctx.orgId}
          and owner_id = ${ctx.userId} and subscription_id = ${body.subscriptionId}
      `),
        ).length;
      if (!rows(result).length && !replay) throw notFound('Active diagnostic subscription');
      return { requestId: id };
    },
  );
}
