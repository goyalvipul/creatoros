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
  /** Pages read. Instagram may return empty pages that still carry paging.next; those are followed to the end. */
  pages?: number;
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
    followEmptyPages = 0,
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
        if (followEmptyPages && countOf) {
          let next: string | null = body?.paging?.next ?? null;
          let pages = 1;
          while (step.count === 0 && next && pages < followEmptyPages) {
            const r2 = await cctx.fetch(next, {
              method: 'GET',
              headers: { authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(20_000),
            });
            if (!r2.ok) break;
            const b2: any = await r2.json().catch(() => null);
            pages += 1;
            step.count = countOf(b2);
            next = b2?.paging?.next ?? null;
          }
          step.pages = pages;
        }
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
      12,
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
    60,
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

/**
 * Three separate levels, never mixed up:
 *  REACHABLE          the API answered HTTP 200 (says nothing about data)
 *  REACHABLE_NO_DATA  HTTP 200 but zero records came back or were stored
 *  IMPORTED           real records are stored in CreatorOS
 *  END_TO_END         imported records AND a real signed webhook event for the same kind were processed
 */
type Verdict =
  | 'REACHABLE'
  | 'REACHABLE_NO_DATA'
  | 'IMPORTED'
  | 'END_TO_END'
  | 'INCOMPLETE'
  | 'VERIFIED_LIVE'
  | 'BLOCKED_BY_META'
  | 'DATA_RECEIVED'
  | 'FAILED'
  | 'NOT_RUN'
  | 'NOT_RECEIVED'
  | 'RECEIVED_OTHER'
  | 'YES_CODE_MOCK_TESTED'
  | 'NO';

/** Webhook fields CreatorOS needs on the account subscription. */
export const INSTAGRAM_WEBHOOK_FIELDS = [
  'comments',
  'messages',
  'message_reactions',
  'messaging_seen',
  'messaging_postbacks',
];

/**
 * Subscribes the account to the webhook fields CreatorOS handles (a single POST to subscribed_apps). This changes only
 * the Meta-side subscription list; it sends nothing to users, touches no content and does not reconnect the account.
 */
export async function subscribeInstagramWebhooks(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const [conn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.orgId, ctx.orgId)));
  if (!conn || conn.provider !== 'instagram' || !conn.principalHint) throw notFound('Social account');
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  const token = cctx.credentials.accessToken ?? '';
  const version = readInstagramClientConfig(ctx.env.processEnv)?.graphVersion ?? DEFAULT_GRAPH_VERSION;
  const u = new URL(`${INSTAGRAM_GRAPH}/${version}/${conn.principalHint}/subscribed_apps`);
  u.searchParams.set('subscribed_fields', INSTAGRAM_WEBHOOK_FIELDS.join(','));
  const res = await cctx.fetch(u.toString(), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body: any = await res.json().catch(() => null);
  const ok = res.ok && body?.success !== false;
  await audit(ctx, 'social.webhook_subscribe', { type: 'provider_connection', id: conn.id }, undefined, {
    ok,
    status: res.status,
    fields: INSTAGRAM_WEBHOOK_FIELDS,
  });
  const readBack = await cctx.fetch(`${INSTAGRAM_GRAPH}/${version}/${conn.principalHint}/subscribed_apps`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const rb: any = await readBack.json().catch(() => null);
  const subscribed = ((rb?.data ?? []) as any[]).flatMap((a) => a.subscribed_fields ?? []);
  return {
    ok,
    status: res.status,
    error: ok ? null : redact(String(body?.error?.message ?? 'Instagram refused the subscription.'), token),
    requested: INSTAGRAM_WEBHOOK_FIELDS,
    subscribed,
    missing: INSTAGRAM_WEBHOOK_FIELDS.filter((f) => !subscribed.includes(f)),
  };
}

/** The Instagram Diagnostics panel. Verdicts come only from stored real API responses, real stored rows or real signed events. */
export async function instagramDiagnosticsSummary(ctx: Ctx, connectionId: string) {
  const [conn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.orgId, ctx.orgId)));
  if (!conn || conn.provider !== 'instagram') throw notFound('Social account');
  const social = ((conn.config ?? {}) as any).social ?? {};
  const diag = social.diagnostics as { at: string; steps: DiagStep[]; graphVersion: string } | undefined;
  const step = (key: string) => diag?.steps.find((x) => x.key === key);
  const accountId = conn.principalHint ?? '';

  const [stored] = (
    await ctx.db.execute(sql`
      select
        (select count(*)::int from social_media_items where connection_id = ${conn.id}) as media,
        (select coalesce(sum(comments_count), 0)::int from social_media_items where connection_id = ${conn.id}) as reported_comments,
        (select count(*)::int from messages m join conversation_threads t on t.id = m.thread_id
           where t.provider_connection_id = ${conn.id} and t.kind = 'COMMENT' and not t.is_demo) as comments,
        (select count(*)::int from messages m join conversation_threads t on t.id = m.thread_id
           where t.provider_connection_id = ${conn.id} and t.kind = 'DM' and not t.is_demo) as dms`)
  ).rows as { media: number; reported_comments: number; comments: number; dms: number }[];
  const [ev] = (
    await ctx.db.execute(sql`
      select
        count(*)::int as any_received,
        count(*) filter (where ${accountId} <> '' and position(${accountId} in payload::text) > 0)::int as received,
        count(*) filter (where status = 'PROCESSED' and ${accountId} <> '' and position(${accountId} in payload::text) > 0)::int as processed,
        count(*) filter (where status = 'PROCESSED' and position(${accountId} in payload::text) > 0 and payload::text like '%"messaging"%')::int as processed_dm,
        count(*) filter (where status = 'PROCESSED' and position(${accountId} in payload::text) > 0 and payload::text like '%"comments"%')::int as processed_comment,
        max(received_at) as last_at
      from provider_webhook_events where provider = 'instagram'`)
  ).rows as any[];
  const [sent] = (
    await ctx.db.execute(
      sql`select count(*)::int n from social_outbound_messages where connection_id = ${conn.id} and state = 'SENT'`,
    )
  ).rows as { n: number }[];

  const failed = (x: DiagStep) => ({
    verdict: 'FAILED' as Verdict,
    detail: `HTTP ${x.status ?? 'no response'}${x.metaCode != null ? `, Meta error ${x.metaCode}${x.metaSubcode ? `/${x.metaSubcode}` : ''}` : ''}: ${x.message ?? ''}`,
  });
  const notRun = { verdict: 'NOT_RUN' as Verdict, detail: 'Run live checks to test this against Instagram.' };
  /** One capability with its three levels. */
  const capability = (
    key: string,
    label: string,
    importedCount: number,
    webhookProcessed: number,
    scope: string,
    reportedByPlatform = 0,
  ) => {
    const x = step(key);
    if (!x)
      return {
        key,
        label,
        ...notRun,
        reachable: null,
        apiRecords: null,
        imported: importedCount,
        endToEnd: false,
      };
    if (!x.ok)
      return {
        key,
        label,
        ...failed(x),
        reachable: false,
        apiRecords: null,
        imported: importedCount,
        endToEnd: false,
      };
    const endToEnd = importedCount > 0 && webhookProcessed > 0;
    const permissionVerified = (conn.scopes ?? []).includes(scope);
    // Instagram itself says the data exists (comment counts) but returns none: access restriction, not an app defect.
    const blocked =
      permissionVerified && importedCount === 0 && (x.count ?? 0) === 0 && reportedByPlatform > 0;
    const verdict: Verdict = endToEnd
      ? 'END_TO_END'
      : importedCount > 0
        ? 'IMPORTED'
        : blocked
          ? 'BLOCKED_BY_META'
          : (x.count ?? 0) > 0
            ? 'DATA_RECEIVED'
            : 'REACHABLE_NO_DATA';
    const pages = x.pages && x.pages > 1 ? ` (${x.pages} pages read to the end)` : '';
    return {
      key,
      label,
      verdict,
      detail: `API: HTTP ${x.status}, ${x.count ?? 0} record(s)${pages}. Stored in CreatorOS: ${importedCount}. Real webhook events processed: ${webhookProcessed}.${x.note ? ` ${x.note}` : ''}`,
      reachable: true,
      permissionVerified,
      reportedByPlatform,
      apiRecords: x.count ?? 0,
      imported: importedCount,
      endToEnd,
    };
  };
  const reach = (key: string, label: string) => {
    const x = step(key);
    if (!x) return { key, label, ...notRun };
    if (!x.ok) return { key, label, ...failed(x) };
    return {
      key,
      label,
      verdict: 'REACHABLE' as Verdict,
      detail: `HTTP ${x.status}, ${x.count ?? 0} record(s)${x.note ? `. ${x.note}` : ''}`,
    };
  };

  const subStep = step('webhooks');
  const subscribedFields = (subStep?.note ?? '').startsWith('Subscribed fields: ')
    ? subStep!
        .note!.slice('Subscribed fields: '.length)
        .split(',')
        .map((f) => f.trim())
    : [];
  const needed = ['comments', 'messages'];
  const missingFields = subStep?.ok ? needed.filter((f) => !subscribedFields.includes(f)) : [];
  const subscription = !subStep
    ? { key: 'webhookSubscription', label: 'Webhook subscription present at Meta', ...notRun }
    : !subStep.ok
      ? { key: 'webhookSubscription', label: 'Webhook subscription present at Meta', ...failed(subStep) }
      : {
          key: 'webhookSubscription',
          label: 'Webhook subscription present at Meta',
          verdict: (missingFields.length ? 'INCOMPLETE' : 'REACHABLE') as Verdict,
          detail: `Subscribed: ${subscribedFields.join(', ') || 'none'}.${missingFields.length ? ` Missing: ${missingFields.join(', ')}. Use "Subscribe to comments and messages".` : ''}`,
        };

  const anyOther = ev.any_received > 0 && ev.received === 0;
  const approvals: string[] = [];
  const missingScopes = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
  ].filter((r) => !(conn.scopes ?? []).includes(r));
  approvals.push(...missingScopes.map((m) => `Permission not granted: ${m}. Reconnect and approve it.`));
  if (missingFields.length)
    approvals.push(
      `Account webhook subscription lacks: ${missingFields.join(', ')}. Click "Subscribe to comments and messages" (changes only the Meta-side subscription list).`,
    );
  if ((step('comments')?.count ?? 0) === 0 && (step('comments')?.ok ?? false))
    approvals.push(
      'Instagram returns 0 comments although posts report comments. While the Meta app is in Development mode, comments and messages are only returned for accounts with a role on the app (Instagram Tester/Developer/Admin). Fix: App roles > Roles > add the other Instagram account as an Instagram Tester and accept the invitation inside Instagram (Settings > Apps and websites > Tester invitations); for the public you need Advanced Access via App Review and the app switched to Live.',
    );
  if (ev.any_received === 0)
    approvals.push(
      `No webhook POST has reached CreatorOS. In the Meta app dashboard open Instagram > API setup with Instagram login > "Configure webhooks": Callback URL https://<your public host>/api/v1/integrations/meta/instagram/webhook, Verify token = META_WEBHOOK_VERIFY_TOKEN from .env, press "Verify and save", then switch on the comments and messages fields. The "Test" button next to a field sends a signed sample POST and proves the delivery path.`,
    );

  return {
    ranAt: diag?.at ?? null,
    graphVersion: diag?.graphVersion ?? null,
    levels: {
      REACHABLE: 'The API answered HTTP 200. Says nothing about data.',
      REACHABLE_NO_DATA: 'HTTP 200 but zero records were returned or stored.',
      IMPORTED: 'Real records are stored in CreatorOS.',
      END_TO_END: 'Records are stored AND a real signed webhook event of that kind was processed.',
    },
    items: [
      reach('profile', 'Profile API'),
      capability('media', 'Posts (media)', stored?.media ?? 0, 0, 'instagram_business_basic'),
      capability(
        'comments',
        'Comments',
        stored?.comments ?? 0,
        ev.processed_comment,
        'instagram_business_manage_comments',
        stored?.reported_comments ?? 0,
      ),
      capability(
        'conversations',
        'Conversations and DMs',
        stored?.dms ?? 0,
        ev.processed_dm,
        'instagram_business_manage_messages',
      ),
      subscription,
      {
        key: 'webhookDelivery',
        label: 'Webhook delivery',
        verdict: (ev.received > 0
          ? 'VERIFIED_LIVE'
          : anyOther
            ? 'RECEIVED_OTHER'
            : 'NOT_RECEIVED') as Verdict,
        detail:
          ev.received > 0
            ? `${ev.received} signed event(s) for this account stored (latest ${new Date(ev.last_at).toISOString()}).`
            : anyOther
              ? `${ev.any_received} signed delivery(ies) reached CreatorOS, none for this account (Meta's dashboard Test button uses sample ids). The network path and signature check work.`
              : 'No webhook POST has ever reached CreatorOS.',
      },
      {
        key: 'eventProcessing',
        label: 'Event processing',
        verdict: (ev.processed > 0 ? 'VERIFIED_LIVE' : 'NOT_RUN') as Verdict,
        detail:
          ev.processed > 0
            ? `${ev.processed} real event(s) processed into conversations.`
            : 'Not tested: no real event for this account has arrived.',
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
        verdict: ((sent?.n ?? 0) > 0 ? 'VERIFIED_LIVE' : 'NO') as Verdict,
        detail:
          (sent?.n ?? 0) > 0
            ? `${sent!.n} message(s) accepted by Instagram.`
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
