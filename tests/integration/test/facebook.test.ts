import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, providerConnections, providerWebhookEvents, socialAccounts, sql } from '@creatoros/db';
import {
  completeOAuth,
  createBrand,
  createChannel,
  createSocialAccount,
  inspectIdentity,
  listSocialAccounts,
  listSocialThreads,
  processFacebookWebhookEvents,
  receiveFacebookWebhook,
  replyToThread,
  startOAuth,
  syncSocialAccount,
} from '@creatoros/services';
import { makeOrg, openDb, testEnv } from '../src/helpers';

const h = openDb();
afterAll(async () => {
  await h.db.execute(sql`delete from workflow_approvals`);
  await h.db.execute(sql`delete from workflow_executions`);
  await h.db.execute(sql`delete from social_outbound_messages`);
  await h.db.delete(providerConnections).where(eq(providerConnections.provider, 'facebook'));
  await h.close();
});

const processEnv = {
  FACEBOOK_APP_ID: 'fbapp',
  FACEBOOK_APP_SECRET: 'fb-secret-xyz',
  FACEBOOK_REDIRECT_URI: 'https://box.test/api/v1/integrations/meta/facebook/callback',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-me',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
];
const now = () => new Date().toISOString();

/** Fake Graph API. Records every write so tests can prove what was (not) sent and with which token. */
function fakeGraph(pageId: string, pageName: string, opts: { emptyAccounts?: boolean } = {}) {
  const writes: { url: string; token: string; body: any }[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const hd = new Headers(init.headers as any);
    const token = String(hd.get('authorization') ?? '').replace('Bearer ', '');
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (u.pathname.endsWith('/oauth/access_token'))
      return json({ access_token: u.searchParams.get('grant_type') ? 'user-long' : 'user-short' });
    if (u.pathname.endsWith('/me/permissions'))
      return json({ data: SCOPES.map((permission) => ({ permission, status: 'granted' })) });
    if (u.pathname.endsWith('/psid9')) return json({ name: 'Live Fan' });
    if (u.pathname.endsWith('/debug_token'))
      return json({ data: { granular_scopes: [{ scope: 'pages_messaging', target_ids: [pageId] }] } });
    if (u.pathname === `/${'v23.0'}/${pageId}` || u.pathname.endsWith(`/${pageId}`))
      if (!u.pathname.includes('/', u.pathname.indexOf(pageId)))
        return json({ id: pageId, name: pageName, access_token: `ptoken-${pageId}`, tasks: ['MESSAGING'] });
    if (u.pathname.endsWith('/me/accounts') && opts.emptyAccounts) return json({ data: [] });
    if (u.pathname.endsWith('/me/accounts'))
      return json({
        data: [
          {
            id: pageId,
            name: pageName,
            access_token: `ptoken-${pageId}`,
            tasks: ['MESSAGING'],
            category: 'Artist',
          },
        ],
      });
    if (u.pathname.endsWith('/subscribed_apps')) {
      if (init.method === 'POST') {
        writes.push({ url, token, body: Object.fromEntries(u.searchParams) });
        return json({ success: true });
      }
      return json({
        data: [{ subscribed_fields: ['messages', 'messaging_postbacks', 'message_reactions', 'feed'] }],
      });
    }
    if (u.pathname.endsWith('/conversations'))
      return json({
        data: [
          {
            id: 't_1',
            updated_time: now(),
            participants: { data: [{ id: pageId }, { id: 'psid1', name: 'Fan One' }] },
            messages: {
              data: [
                { id: 'm_2', created_time: now(), from: { id: pageId }, message: 'thanks!' },
                {
                  id: 'm_1',
                  created_time: now(),
                  from: { id: 'psid1', name: 'Fan One' },
                  message: 'hello page',
                },
              ],
            },
          },
        ],
      });
    if (u.pathname.endsWith('/published_posts'))
      return json({
        data: [
          {
            id: `${pageId}_p1`,
            message: 'new video',
            permalink_url: 'https://fb/p1',
            created_time: now(),
            comments: { summary: { total_count: 2 } },
          },
        ],
      });
    if (u.pathname.endsWith('/comments') && init.method !== 'POST')
      return json({
        data: [
          {
            id: `${pageId}_p1_c1`,
            message: 'great!',
            from: { id: 'u7', name: 'Viewer' },
            created_time: now(),
          },
          {
            id: `${pageId}_p1_c2`,
            message: 'thank you',
            from: { id: pageId, name: pageName },
            created_time: now(),
            parent: { id: `${pageId}_p1_c1` },
          },
        ],
      });
    if (init.method === 'POST' && (u.pathname.endsWith('/messages') || u.pathname.endsWith('/comments'))) {
      writes.push({ url, token, body });
      return json(
        u.pathname.endsWith('/messages')
          ? { message_id: 'mid-out-1', recipient_id: body?.recipient?.id }
          : { id: 'cid-out-1' },
      );
    }
    return json({ data: [] });
  };
  return { writes, overrides: { fetch: fetchImpl as any, sleep: async () => {} } };
}

async function world(opts: { account?: 'verified' | 'username' | 'none'; emptyAccounts?: boolean } = {}) {
  const pageId = `9${Math.floor(Math.random() * 1e8)}`;
  const env = testEnv({ processEnv });
  const org = await makeOrg(h, env);
  const brand: any = await createBrand(org.ctx, { name: 'Mehak' });
  const channel: any = await createChannel(org.ctx, { brandId: brand.id, name: 'Mehak Thakur' });
  let acct: any = null;
  if (opts.account === 'verified')
    acct = await createSocialAccount(org.ctx, {
      channelId: channel.id,
      platform: 'facebook',
      handle: '@renamed',
      externalAccountId: pageId,
    });
  if (opts.account === 'username')
    acct = await createSocialAccount(org.ctx, {
      channelId: channel.id,
      platform: 'facebook',
      handle: '@Mehak Page',
    });
  const g = fakeGraph(pageId, 'Mehak Page', { emptyAccounts: opts.emptyAccounts });
  const s = await startOAuth(org.ctx, 'facebook', {}, g.overrides);
  const state = new URL(s.authorizeUrl!).searchParams.get('state')!;
  const done: any = await completeOAuth(h.db, env, { state, code: 'c1' }, g.overrides);
  return { env, org, brand, channel, acct, g, pageId, conn: done.connectionId as string };
}
const sign = (body: string) =>
  `sha256=${createHmac('sha256', processEnv.FACEBOOK_APP_SECRET).update(body).digest('hex')}`;

describe('Facebook Pages connection', () => {
  it('stores one connection per Page with an encrypted Page token, subscribes webhooks and never exposes the token', async () => {
    const w = await world();
    const [c] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, w.conn));
    expect(c).toMatchObject({ provider: 'facebook', principalHint: w.pageId, state: 'ACTIVE' });
    expect(c!.scopes).toContain('pages_messaging');
    expect(JSON.stringify(c)).not.toContain(`ptoken-${w.pageId}`);
    expect(w.g.writes.find((x) => x.url.includes('/subscribed_apps'))?.body.subscribed_fields).toContain(
      'feed',
    );
    expect((c!.config as any).webhook.missing).toEqual([]);
    const accounts: any[] = await listSocialAccounts(w.org.ctx);
    expect(accounts.find((a) => a.id === w.conn)).toMatchObject({
      platform: 'FACEBOOK',
      capabilities: { sendMessages: 'AVAILABLE', replyComments: 'AVAILABLE' },
    });
    // reconnecting updates the same row
    const s = await startOAuth(w.org.ctx, 'facebook', {}, w.g.overrides);
    const again: any = await completeOAuth(
      h.db,
      w.env,
      { state: new URL(s.authorizeUrl!).searchParams.get('state')!, code: 'c2' },
      w.g.overrides,
    );
    expect(again.connectionId).toBe(w.conn);
  });

  it('auto-links only on the verified Page id; a name match waits for owner confirmation; no brand or channel is created', async () => {
    const v = await world({ account: 'verified' });
    expect(
      (await h.db.select().from(socialAccounts).where(eq(socialAccounts.id, v.acct.id)))[0]!
        .providerConnectionId,
    ).toBe(v.conn);
    const u = await world({ account: 'username' });
    const [row] = await h.db.select().from(socialAccounts).where(eq(socialAccounts.id, u.acct.id));
    expect(row!.providerConnectionId).toBeNull();
    const [conn] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, u.conn));
    expect((await inspectIdentity(u.org.ctx, conn!))?.status).toBe('NEEDS_CONFIRMATION');
    const [{ b, c }] = (
      await h.db.execute(
        sql`select (select count(*)::int from brands where org_id=${u.org.ctx.orgId}) b, (select count(*)::int from channels where org_id=${u.org.ctx.orgId}) c`,
      )
    ).rows as any[];
    expect([b, c]).toEqual([1, 1]);
  });
});

describe('Facebook Page discovery fallback', () => {
  it('finds a Page granted per-asset when /me/accounts is empty', async () => {
    const w = await world({ emptyAccounts: true });
    const [c] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, w.conn));
    expect(c).toMatchObject({ principalHint: w.pageId, state: 'ACTIVE' });
  });
});

describe('Facebook sync, webhooks and replies', () => {
  it('imports DMs, posts and comments as historical, idempotently, without automation', async () => {
    const w = await world({ account: 'verified' });
    const r1: any = await syncSocialAccount(w.org.ctx, w.conn, w.g.overrides);
    expect(r1.state).toBe('OK');
    expect(r1.counts).toMatchObject({ posts: 1, comments: 2, conversations: 1, messages: 2 });
    const r2: any = await syncSocialAccount(w.org.ctx, w.conn, w.g.overrides);
    expect(r2.counts.newMessages).toBe(0);
    const [{ n }] = (
      await h.db.execute(
        sql`select count(*)::int n from messages m join conversation_threads t on t.id=m.thread_id where t.provider_connection_id=${w.conn}`,
      )
    ).rows as any[];
    expect(n).toBe(4);
    const dm = (await listSocialThreads(w.org.ctx, { kind: 'DM' }))[0] as any;
    expect(dm).toMatchObject({ connectionId: w.conn });
    const [{ x }] = (
      await h.db.execute(
        sql`select count(*)::int x from workflow_executions e join workflows f on f.id=e.workflow_id where f.org_id=${w.org.ctx.orgId}`,
      )
    ).rows as any[];
    expect(x).toBe(0);
    expect(w.g.writes.filter((x) => !x.url.includes('/subscribed_apps'))).toHaveLength(0); // sync never sends
  });

  it('rejects unsigned deliveries, stores signed ones once and routes them to the right Page only', async () => {
    const w = await world({ account: 'verified' });
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: w.pageId,
          time: Date.now() / 1000,
          messaging: [
            {
              sender: { id: 'psid9' },
              recipient: { id: w.pageId },
              timestamp: Date.now(),
              message: { mid: `mid-${w.pageId}`, text: 'live hello' },
            },
          ],
        },
        {
          id: w.pageId,
          time: Date.now() / 1000,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: `${w.pageId}_c9`,
                post_id: `${w.pageId}_p1`,
                parent_id: `${w.pageId}_p1`,
                from: { id: 'u9', name: 'Viewer' },
                message: 'nice',
                created_time: Math.floor(Date.now() / 1000),
              },
            },
          ],
        },
        { id: '0', time: 1, changes: [] },
      ],
    });
    await expect(receiveFacebookWebhook(h.db, w.env, body, 'sha256=bad')).rejects.toThrow();
    const r = await receiveFacebookWebhook(h.db, w.env, body, sign(body));
    expect(r.stored).toBe(3);
    expect((await receiveFacebookWebhook(h.db, w.env, body, sign(body))).stored).toBe(0);
    await processFacebookWebhookEvents(h.db, w.env, w.g.overrides, 500);
    const threads: any[] = await listSocialThreads(w.org.ctx, {});
    expect(threads.map((t) => t.kind).sort()).toEqual(['COMMENT', 'DM']);
    // numeric sender ids are replaced by the real name on the next sync
    const dmBefore: any = threads.find((t) => t.kind === 'DM');
    expect(dmBefore.participantName ?? dmBefore.participantId).toBe('psid9');
    await syncSocialAccount(w.org.ctx, w.conn, w.g.overrides);
    const dmAfter: any = (await listSocialThreads(w.org.ctx, { kind: 'DM' })).find(
      (t: any) => t.participantId === 'psid9',
    );
    expect(dmAfter.participantName).toBe('Live Fan');
    const events = await h.db
      .select()
      .from(providerWebhookEvents)
      .where(eq(providerWebhookEvents.provider, 'facebook'));
    expect(events.filter((e) => e.status === 'IGNORED').length).toBeGreaterThanOrEqual(1);
  });

  it('replies from the owning Page with its own token, only on explicit send, and refuses the wrong connection', async () => {
    const w = await world({ account: 'verified' });
    const other = await world({ account: 'verified' });
    await syncSocialAccount(w.org.ctx, w.conn, w.g.overrides);
    const dm: any = (await listSocialThreads(w.org.ctx, { kind: 'DM' }))[0];
    const cm: any = (await listSocialThreads(w.org.ctx, { kind: 'COMMENT' }))[0];
    const before = w.g.writes.length;
    // draft only: nothing leaves
    const draft: any = await replyToThread(
      w.org.ctx,
      dm.id,
      { connectionId: w.conn, text: 'draft', requestId: `req-${w.pageId}-0`, send: false },
      w.g.overrides,
    );
    expect(draft.state).toBe('DRAFT');
    expect(w.g.writes.length).toBe(before);
    await expect(
      replyToThread(
        w.org.ctx,
        dm.id,
        { connectionId: other.conn, text: 'x', requestId: `req-${w.pageId}-1`, send: true },
        w.g.overrides,
      ),
    ).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
    const sent: any = await replyToThread(
      w.org.ctx,
      dm.id,
      { connectionId: w.conn, text: 'hi there', requestId: `req-${w.pageId}-2`, send: true },
      w.g.overrides,
    );
    expect(sent.state).toBe('SENT');
    const w1 = w.g.writes[w.g.writes.length - 1]!;
    expect(w1.url).toContain(`/${w.pageId}/messages`);
    expect(w1.token).toBe(`ptoken-${w.pageId}`);
    expect(w1.body.recipient.id).toBe('psid1');
    const c: any = await replyToThread(
      w.org.ctx,
      cm.id,
      { connectionId: w.conn, text: 'thanks', requestId: `req-${w.pageId}-3`, send: true },
      w.g.overrides,
    );
    expect(c.state).toBe('SENT');
    expect(w.g.writes[w.g.writes.length - 1]!.url).toContain(`/${w.pageId}_p1_c1/comments`);
    // idempotent
    await replyToThread(
      w.org.ctx,
      dm.id,
      { connectionId: w.conn, text: 'hi there', requestId: `req-${w.pageId}-2`, send: true },
      w.g.overrides,
    );
    expect(w.g.writes.filter((x) => x.url.endsWith('/messages'))).toHaveLength(1);
  });
});
