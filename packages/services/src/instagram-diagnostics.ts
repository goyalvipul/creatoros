import { and, eq, providerConnections, sql, type Db } from '@creatoros/db';
import {
  DEFAULT_GRAPH_VERSION,
  INSTAGRAM_GRAPH,
  readInstagramClientConfig,
  type ConnectorContext,
} from '@creatoros/connectors';
import { connectorContext } from './integrations';
import { audit } from './audit';
import { notFound, type Ctx } from './types';

export interface DiagStep {
  key: string;
  label: string;
  endpoint: string;
  ok: boolean;
  status: number | null;
  count: number | null;
  metaCode: number | null;
  metaSubcode: number | null;
  metaType: string | null;
  message: string | null;
  traceId: string | null;
  note?: string;
  at: string;
  /** Always 'LIVE': a real HTTPS request to graph.instagram.com. Mock runs are never stored here. */
  evidence: 'LIVE';
}

const redact = (s: string, token: string) =>
  s
    .split(token)
    .join('[token]')
    .replace(/access_token=[^&\s"']+/gi, 'access_token=[token]')
    .replace(/IG[A-Za-z0-9_-]{40,}/g, '[token]')
    .slice(0, 400);

/**
 * Read-only live probe of every Instagram API the Socials module relies on. Only GET requests are made.
 * Nothing is sent, posted or changed, and the token never appears in the result.
 */
export async function runInstagramDiagnostics(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const [conn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.orgId, ctx.orgId)));
  if (!conn || conn.provider !== 'instagram') throw notFound('Social account');
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  const token = cctx.credentials.accessToken ?? '';
  const version = readInstagramClientConfig(ctx.env.processEnv)?.graphVersion ?? DEFAULT_GRAPH_VERSION;
  const base = `${INSTAGRAM_GRAPH}/${version}`;
  const steps: DiagStep[] = [];

  async function get(
    key: string,
    label: string,
    path: string,
    query: Record<string, string>,
    countOf?: (d: any) => number,
  ): Promise<any> {
    const u = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    const shown = `GET ${path}?${Object.keys(query).join(',')}`;
    const step: DiagStep = {
      key,
      label,
      endpoint: shown,
      ok: false,
      status: null,
      count: null,
      metaCode: null,
      metaSubcode: null,
      metaType: null,
      message: null,
      traceId: null,
      at: new Date().toISOString(),
      evidence: 'LIVE',
    };
    try {
      if (!token) throw new Error('No stored token.');
      const res = await cctx.fetch(u.toString(), {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      step.status = res.status;
      step.traceId = res.headers.get('x-fb-trace-id') ?? res.headers.get('x-fb-request-id');
      const text = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      if (res.ok) {
        step.ok = true;
        step.count = countOf ? countOf(body) : null;
        steps.push(step);
        return body;
      }
      const e = body?.error ?? {};
      step.metaCode = typeof e.code === 'number' ? e.code : null;
      step.metaSubcode = typeof e.error_subcode === 'number' ? e.error_subcode : null;
      step.metaType = e.type ?? null;
      step.traceId = e.fbtrace_id ?? step.traceId;
      step.message = redact(String(e.message ?? text), token);
    } catch (err) {
      step.message = redact(`Request failed: ${(err as Error).message}`, token);
    }
    steps.push(step);
    return null;
  }

  const me = await get(
    'profile',
    'Profile API',
    '/me',
    { fields: 'user_id,username,account_type,media_count' },
    (d) => (d?.user_id || d?.id ? 1 : 0),
  );
  const media = await get(
    'media',
    'Media API',
    '/me/media',
    { fields: 'id,media_type,permalink,timestamp,comments_count', limit: '10' },
    (d) => d?.data?.length ?? 0,
  );
  const items: any[] = media?.data ?? [];
  const pick = items.find((m) => Number(m.comments_count) > 0) ?? items[0];
  if (pick) {
    const c = await get(
      'comments',
      'Comments API',
      `/${pick.id}/comments`,
      { fields: 'id,text,username,timestamp', limit: '10' },
      (d) => d?.data?.length ?? 0,
    );
    if (c && !(c.data?.length > 0))
      steps[steps.length - 1]!.note =
        Number(pick.comments_count) === 0
          ? 'The post has no comments, so 0 records is expected.'
          : `Instagram reports ${pick.comments_count} comments on this post but returned none. In development mode (or without Advanced Access) Instagram may only return comments from accounts with a role on the app. Not confirmed with Meta.`;
  } else
    steps.push({
      key: 'comments',
      label: 'Comments API',
      endpoint: 'GET /{media-id}/comments',
      ok: false,
      status: null,
      count: null,
      metaCode: null,
      metaSubcode: null,
      metaType: null,
      message: 'Skipped: no media was returned, so there is nothing to read comments from.',
      traceId: null,
      at: new Date().toISOString(),
      evidence: 'LIVE',
    });
  const convs = await get(
    'conversations',
    'Conversations API',
    '/me/conversations',
    { platform: 'instagram', fields: 'id,updated_time', limit: '10' },
    (d) => d?.data?.length ?? 0,
  );
  const conv = convs?.data?.[0];
  if (conv)
    await get(
      'messages',
      'Messages API',
      `/${conv.id}`,
      { fields: 'messages.limit(5){id,created_time,from,message}' },
      (d) => d?.messages?.data?.length ?? 0,
    );
  const subs = await get(
    'webhooks',
    'Webhook subscription',
    `/${conn.principalHint ?? 'me'}/subscribed_apps`,
    {},
    (d) => d?.data?.length ?? 0,
  );
  if (subs) {
    const fields = (subs.data ?? []).flatMap((a: any) => a.subscribed_fields ?? []);
    steps[steps.length - 1]!.note = fields.length
      ? `Subscribed fields: ${fields.join(', ')}`
      : 'Meta reports no subscribed fields for this account.';
  }
  const withComments = items.filter((m) => Number(m.comments_count) > 0).length;
  const cs = steps.find((x) => x.key === 'comments');
  if (cs?.ok && items.length)
    cs.note = `${withComments} of the ${items.length} newest posts have comments. ${cs.note ?? ''}`.trim();

  const result = {
    at: new Date().toISOString(),
    graphVersion: version,
    account: me
      ? { id: me.user_id ?? me.id, username: me.username ?? null, type: me.account_type ?? null }
      : null,
    grantedScopes: conn.scopes ?? [],
    steps,
  };
  // keep only the latest run on the connection; it is evidence, not secret
  await ctx.db
    .update(providerConnections)
    .set({
      config: {
        ...(conn.config as object),
        social: { ...((conn.config as any)?.social ?? {}), diagnostics: result },
      },
      updatedAt: new Date(),
    })
    .where(eq(providerConnections.id, conn.id));
  await audit(ctx, 'social.diagnostics', { type: 'provider_connection', id: conn.id }, undefined, {
    steps: steps.map((s) => ({ key: s.key, ok: s.ok, status: s.status })),
  });
  return result;
}

export type { Db };

type Verdict = 'VERIFIED_LIVE' | 'FAILED' | 'NOT_RUN' | 'NOT_RECEIVED' | 'YES_CODE_MOCK_TESTED' | 'NO';

/** The Instagram Diagnostics panel. `VERIFIED_LIVE` only ever comes from a stored real API response or a real stored event. */
export async function instagramDiagnosticsSummary(ctx: Ctx, connectionId: string) {
  const [conn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.orgId, ctx.orgId)));
  if (!conn || conn.provider !== 'instagram') throw notFound('Social account');
  const social = ((conn.config ?? {}) as any).social ?? {};
  const diag = social.diagnostics as { at: string; steps: DiagStep[]; graphVersion: string } | undefined;
  const step = (key: string) => diag?.steps.find((x) => x.key === key);
  const live = (key: string): { verdict: Verdict; detail: string } => {
    const x = step(key);
    if (!x) return { verdict: 'NOT_RUN', detail: 'Run diagnostics to test this against Instagram.' };
    if (x.ok)
      return {
        verdict: 'VERIFIED_LIVE',
        detail: `HTTP ${x.status}, ${x.count ?? 0} record(s)${x.note ? `. ${x.note}` : ''}`,
      };
    return {
      verdict: 'FAILED',
      detail: `HTTP ${x.status ?? 'no response'}${x.metaCode != null ? `, Meta error ${x.metaCode}${x.metaSubcode ? `/${x.metaSubcode}` : ''}` : ''}: ${x.message ?? ''}`,
    };
  };
  const accountId = conn.principalHint ?? '';
  const rows = (
    await ctx.db.execute(sql`
      select count(*)::int as received,
             count(*) filter (where status = 'PROCESSED')::int as processed
      from provider_webhook_events
      where provider = 'instagram' and ${accountId} <> '' and position(${accountId} in payload::text) > 0`)
  ).rows as { received: number; processed: number }[];
  const ev = rows[0] ?? { received: 0, processed: 0 };
  const sent = (
    await ctx.db.execute(
      sql`select count(*)::int n from social_outbound_messages where connection_id = ${conn.id} and state = 'SENT'`,
    )
  ).rows as { n: number }[];
  const required = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
  ];
  const missing = required.filter((r) => !(conn.scopes ?? []).includes(r));
  const approvals = [
    ...missing.map((m) => `Permission not granted: ${m}. Reconnect and approve it.`),
    'Meta App Review (Advanced Access) is required before accounts outside your own app roles can message or comment: not verified for this app.',
    'Instagram only delivers webhook events for accounts and testers that have a role on the app while it is in development mode.',
  ];
  return {
    ranAt: diag?.at ?? null,
    graphVersion: diag?.graphVersion ?? null,
    items: [
      { key: 'connection', label: 'Live connection verified', ...live('profile') },
      { key: 'profile', label: 'Profile API verified', ...live('profile') },
      { key: 'media', label: 'Media API verified', ...live('media') },
      { key: 'comments', label: 'Comments API verified', ...live('comments') },
      { key: 'conversations', label: 'Conversations API verified', ...live('conversations') },
      { key: 'webhookSubscription', label: 'Webhook subscription present at Meta', ...live('webhooks') },
      {
        key: 'webhookDelivery',
        label: 'Webhook delivery verified',
        verdict: (ev.received > 0 ? 'VERIFIED_LIVE' : 'NOT_RECEIVED') as Verdict,
        detail:
          ev.received > 0
            ? `${ev.received} signed event(s) stored.`
            : 'No event has ever reached CreatorOS for this account.',
      },
      {
        key: 'eventProcessing',
        label: 'Event processing verified',
        verdict: (ev.processed > 0 ? 'VERIFIED_LIVE' : 'NOT_RUN') as Verdict,
        detail:
          ev.processed > 0
            ? `${ev.processed} event(s) processed into conversations.`
            : 'Nothing real to process yet.',
      },
      {
        key: 'replyImplemented',
        label: 'Reply API implemented',
        verdict: 'YES_CODE_MOCK_TESTED' as Verdict,
        detail: 'Code exists and passes tests against fake responses only.',
      },
      {
        key: 'replyLive',
        label: 'Reply live-tested',
        verdict: ((sent[0]?.n ?? 0) > 0 ? 'VERIFIED_LIVE' : 'NO') as Verdict,
        detail:
          (sent[0]?.n ?? 0) > 0
            ? `${sent[0]!.n} message(s) accepted by Instagram.`
            : 'No real reply has been sent. This needs your explicit approval.',
      },
      {
        key: 'publishing',
        label: 'Publishing implemented',
        verdict: 'NO' as Verdict,
        detail: 'Not built; nothing is published.',
      },
    ],
    approvals,
    sync: social.sync ?? null,
  };
}
