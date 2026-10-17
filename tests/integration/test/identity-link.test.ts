import { afterAll, describe, expect, it } from 'vitest';
import { eq, providerConnections, socialAccounts, sql } from '@creatoros/db';
import {
  completeOAuth,
  confirmAccountLink,
  createAndLinkAccount,
  createBrand,
  createChannel,
  createSocialAccount,
  inspectIdentity,
  listIntegrations,
  startOAuth,
  syncInstagramAccount,
} from '@creatoros/services';
import { makeOrg, openDb, testEnv } from '../src/helpers';

const h = openDb();
afterAll(async () => {
  await h.db.execute(sql`delete from workflow_approvals`);
  await h.db.execute(sql`delete from social_outbound_messages`);
  await h.db.delete(providerConnections).where(eq(providerConnections.provider, 'instagram'));
  await h.close();
});

const processEnv = {
  INSTAGRAM_APP_ID: 'app1',
  INSTAGRAM_APP_SECRET: 'sekret',
  INSTAGRAM_REDIRECT_URI: 'https://box.test/cb',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-me',
};
const json = (b: unknown) =>
  new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const ALL = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';
const USERS: Record<string, { id: string; username: string }> = {
  c1: { id: '5001', username: 'mehakviking' },
  c2: { id: '5002', username: 'other' },
};
const overrides = {
  sleep: async () => {},
  fetch: (async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('https://api.instagram.com/oauth/access_token')) {
      const u = USERS[new URLSearchParams(String(init.body)).get('code')!]!;
      return json({ data: [{ access_token: `short-${u.id}`, user_id: u.id, permissions: ALL }] });
    }
    if (url.includes('/access_token?'))
      return json({
        access_token: new URL(url).searchParams.get('access_token')!.replace('short', 'long'),
        expires_in: 5_184_000,
      });
    if (url.includes('/me?')) {
      const t =
        new URL(url).searchParams.get('access_token') ??
        String((init.headers as any)?.authorization ?? '').replace('Bearer ', '');
      const u = Object.values(USERS).find((x) => t.endsWith(x.id))!;
      return json({ user_id: u.id, username: u.username, account_type: 'CREATOR', media_count: 1 });
    }
    if (url.includes('/me/media'))
      return json({
        data: [
          {
            id: 'm1',
            caption: 'x',
            media_type: 'VIDEO',
            permalink: 'https://ig/p/1',
            timestamp: '2026-10-01T10:00:00+0000',
          },
        ],
      });
    return json({ data: [] });
  }) as any,
};

async function world() {
  const env = testEnv({ processEnv });
  const org = await makeOrg(h, env);
  const brand: any = await createBrand(org.ctx, { name: 'Mehak' });
  const channel: any = await createChannel(org.ctx, { brandId: brand.id, name: 'Mehak Thakur' });
  const connect = async (code: string) => {
    const s = await startOAuth(org.ctx, 'instagram', { messages: true, comments: true }, overrides);
    const state = new URL(s.authorizeUrl!).searchParams.get('state')!;
    return (await completeOAuth(h.db, env, { state, code }, overrides)).connectionId;
  };
  return { env, org, brand, channel, connect };
}
const acct = async (id: string) =>
  (await h.db.select().from(socialAccounts).where(eq(socialAccounts.id, id)))[0]!;
const connRow = async (id: string) =>
  (await h.db.select().from(providerConnections).where(eq(providerConnections.id, id)))[0]!;

describe('connection <-> channel account identity', () => {
  it('never links by username alone; the owner confirms once, which stores the verified id', async () => {
    const w = await world();
    const manual: any = await createSocialAccount(w.org.ctx, {
      channelId: w.channel.id,
      platform: 'instagram',
      handle: '@mehakviking',
    });
    const conn = await w.connect('c1');
    expect((await acct(manual.id)).providerConnectionId).toBeNull();
    const before = await inspectIdentity(w.org.ctx, await connRow(conn));
    expect(before?.status).toBe('NEEDS_CONFIRMATION');
    expect(before?.candidates[0]).toMatchObject({ id: manual.id, match: 'USERNAME_ONLY' });
    // partial-sync warning is explained while unlinked
    const list: any[] = await listIntegrations(w.org.ctx, overrides as any);
    expect(JSON.stringify(list)).toContain('NEEDS_CONFIRMATION');
    await confirmAccountLink(w.org.ctx, conn, manual.id);
    const after = await acct(manual.id);
    expect(after.providerConnectionId).toBe(conn);
    expect(after.externalAccountId).toBe('5001');
    expect(after.verifiedLink).toBe(true);
    expect((await inspectIdentity(w.org.ctx, await connRow(conn)))?.status).toBe('LINKED');
  });

  it('auto-links on a verified id match, also after reconnect, without duplicating accounts', async () => {
    const w = await world();
    const known: any = await createSocialAccount(w.org.ctx, {
      channelId: w.channel.id,
      platform: 'instagram',
      handle: '@renamedhandle',
      externalAccountId: '5001',
    });
    const conn = await w.connect('c1');
    expect((await acct(known.id)).providerConnectionId).toBe(conn);
    const again = await w.connect('c1');
    expect(again).toBe(conn);
    expect((await acct(known.id)).providerConnectionId).toBe(conn);
    const rows = await h.db.select().from(socialAccounts).where(eq(socialAccounts.orgId, w.org.ctx.orgId));
    expect(rows.filter((r) => !r.deletedAt)).toHaveLength(1);
  });

  it('refuses an account whose verified id differs, an account of another connection, and a duplicate creation', async () => {
    const w = await world();
    const wrong: any = await createSocialAccount(w.org.ctx, {
      channelId: w.channel.id,
      platform: 'instagram',
      handle: '@x',
      externalAccountId: '9999',
    });
    const c1 = await w.connect('c1');
    await expect(confirmAccountLink(w.org.ctx, c1, wrong.id)).rejects.toThrow();
    const mine: any = await createSocialAccount(w.org.ctx, {
      channelId: w.channel.id,
      platform: 'instagram',
      handle: '@mehakviking',
    });
    await confirmAccountLink(w.org.ctx, c1, mine.id);
    const c2 = await w.connect('c2');
    await expect(confirmAccountLink(w.org.ctx, c2, mine.id)).rejects.toThrow();
    await createAndLinkAccount(w.org.ctx, c2, w.channel.id);
    const c2row = await h.db.select().from(socialAccounts).where(eq(socialAccounts.providerConnectionId, c2));
    expect(c2row).toHaveLength(1);
    expect(c2row[0]!.handle.replace('@', '')).toBe('other');
    await expect(createAndLinkAccount(w.org.ctx, c2, w.channel.id)).rejects.toThrow();
  });

  it('creates under an existing channel when none exists and never creates a brand or channel', async () => {
    const w = await world();
    const conn = await w.connect('c1');
    expect((await inspectIdentity(w.org.ctx, await connRow(conn)))?.status).toBe('NO_ACCOUNT');
    await createAndLinkAccount(w.org.ctx, conn, w.channel.id);
    const [{ b, c }] = (
      await h.db.execute(
        sql`select (select count(*)::int from brands where org_id = ${w.org.ctx.orgId}) b, (select count(*)::int from channels where org_id = ${w.org.ctx.orgId}) c`,
      )
    ).rows as any[];
    expect([b, c]).toEqual([1, 1]);
  });

  it('a linked connection imports media into the canonical account and the sync is recorded separately', async () => {
    const w = await world();
    const manual: any = await createSocialAccount(w.org.ctx, {
      channelId: w.channel.id,
      platform: 'instagram',
      handle: '@mehakviking',
    });
    const conn = await w.connect('c1');
    await confirmAccountLink(w.org.ctx, conn, manual.id);
    const r = await syncInstagramAccount(w.org.ctx, conn, overrides);
    expect(r.state).toBe('OK');
    expect((await connRow(conn)).lastError ?? '').not.toContain('no social account');
  });
});
