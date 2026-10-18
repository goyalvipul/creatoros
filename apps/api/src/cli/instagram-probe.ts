// Read-only deep probe of Instagram comments / conversations / webhook configuration. GET requests only; no token is printed.
//   docker compose exec api node apps/api/dist/cli/instagram-probe.js @username
import { createDb, eq, providerConnections, sql } from '@creatoros/db';
import { INSTAGRAM_GRAPH, readInstagramClientConfig } from '@creatoros/connectors';
import { connectorContext, loadConfig, subscribeInstagramWebhooks, systemCtx } from '@creatoros/services';

const want = process.argv[2]?.replace(/^@/, '');
const config = loadConfig();
const handle = createDb(config.databaseUrl, { max: 2, applicationName: 'creatoros-ig-probe' });
const cfg = readInstagramClientConfig(config.env.processEnv);
const ver = cfg?.graphVersion ?? 'v23.0';
try {
  const res: any = await handle.db.execute(
    sql`select id from provider_connections where provider='instagram' and config->>'username' = ${want ?? ''}`,
  );
  const id = ((Array.isArray(res) ? res : res.rows)[0] as any).id as string;
  const [conn] = await handle.db.select().from(providerConnections).where(eq(providerConnections.id, id));
  if (process.argv.includes('--subscribe')) {
    const orgRes: any = await handle.db.execute(
      sql`select org_id from provider_connections where id = ${id}`,
    );
    const orgId = ((Array.isArray(orgRes) ? orgRes : orgRes.rows)[0] as any).org_id;
    console.log(
      'subscribe',
      JSON.stringify(
        await subscribeInstagramWebhooks(systemCtx({ db: handle.db, env: config.env }, orgId), id),
      ),
    );
    process.exit(0);
  }
  const token = connectorContext(handle.db, config.env, conn).credentials.accessToken ?? '';
  const clean = (s: string) =>
    s
      .split(token)
      .join('[token]')
      .replace(/access_token=[^&\s"']+/gi, 'access_token=[token]');
  const show = async (
    label: string,
    url: string,
    headers: Record<string, string> = { authorization: `Bearer ${token}` },
  ) => {
    const r = await fetch(url, { headers });
    const text = await r.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {}
    const summary = body?.error
      ? {
          error: {
            code: body.error.code,
            subcode: body.error.error_subcode,
            type: body.error.type,
            message: body.error.message,
          },
        }
      : body?.data
        ? {
            count: body.data.length,
            paging: body.paging ? Object.keys(body.paging) : null,
            sample: body.data.slice(0, 2).map((d: any) => Object.keys(d)),
          }
        : body;
    console.log(
      label,
      r.status,
      clean(JSON.stringify(summary)).slice(0, 700),
      'trace',
      r.headers.get('x-fb-trace-id') ?? '',
    );
    return body;
  };
  const g = (p: string, q: Record<string, string> = {}) =>
    `${INSTAGRAM_GRAPH}/${ver}${p}?${new URLSearchParams(q)}`;

  const me = await show(
    'me',
    g('/me', { fields: 'user_id,username,account_type,media_count,followers_count' }),
  );
  const igId = String(me?.user_id ?? '');
  const media = await show(
    'media',
    g('/me/media', { fields: 'id,comments_count,like_count,timestamp,media_product_type', limit: '25' }),
  );
  const withComments = (media?.data ?? []).filter((m: any) => m.comments_count > 0).slice(0, 3);
  for (const m of withComments) {
    await show(
      `comments(${m.id}) c=${m.comments_count}`,
      g(`/${m.id}/comments`, { fields: 'id,text,username,timestamp,from', limit: '50' }),
    );
    await show(`comments-nofields(${m.id})`, g(`/${m.id}/comments`));
    await show(`replies-edge(${m.id})`, g(`/${m.id}/comments`, { fields: 'id,text,replies{id,text}' }));
  }
  await show(
    'conversations',
    g('/me/conversations', { platform: 'instagram', fields: 'id,updated_time', limit: '25' }),
  );
  await show(
    'conversations(id)',
    g(`/${igId}/conversations`, { platform: 'instagram', fields: 'id,updated_time' }),
  );
  await show('conversations(no-platform)', g('/me/conversations', { fields: 'id' }));
  // Meta sometimes returns an empty first page that still carries paging.next: follow it.
  const follow = async (label: string, first: string) => {
    let url: string | null = first;
    for (let i = 1; url && i <= Number(process.env.PROBE_PAGES ?? 6); i++) {
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      const b: any = await r.json().catch(() => null);
      console.log(
        label,
        'page',
        i,
        r.status,
        'records',
        b?.data?.length ?? 'n/a',
        'next',
        Boolean(b?.paging?.next),
        b?.error?.message ?? '',
      );
      if (b?.data?.length) break;
      url = b?.paging?.next ?? null;
    }
  };
  for (const m of (media?.data ?? [])
    .filter((x: any) => x.comments_count > 0)
    .slice(0, Number(process.env.PROBE_MEDIA ?? 1)))
    await follow(
      `comments-follow(${m.id})`,
      g(`/${m.id}/comments`, { fields: 'id,text,username,timestamp', limit: '50' }),
    );
  await follow(
    'conversations-follow',
    g('/me/conversations', { platform: 'instagram', fields: 'id,updated_time', limit: '25' }),
  );
  await show('subscribed_apps', g(`/${igId}/subscribed_apps`));
  await show('permissions(me/permissions)', g('/me/permissions'));

  // App-level webhook configuration (needs the app secret; read-only)
  if (cfg) {
    const appTok = `${cfg.appId}|${cfg.appSecret}`;
    await show(
      'app.subscriptions',
      `https://graph.facebook.com/${ver}/${cfg.appId}/subscriptions?access_token=${appTok}`,
      {},
    );
    await show(
      'app.info',
      `https://graph.facebook.com/${ver}/${cfg.appId}?fields=name,link&access_token=${appTok}`,
      {},
    );
  }
} finally {
  await handle.close();
}
