import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, providerConnections, providerWebhookEvents, oauthStates, sql } from '@creatoros/db';
import {
  completeOAuth,
  disconnect,
  listIntegrations,
  receiveInstagramWebhook,
  renewInstagramTokens,
  startOAuth,
  verifyMetaHandshake,
} from '@creatoros/services';
import { makeOrg, openDb, testEnv } from '../src/helpers';

const h = openDb();
// The database is shared by every test file: do not leave live-looking connections behind for other suites' sync jobs.
afterAll(async () => {
  await h.db.delete(providerConnections).where(eq(providerConnections.provider, 'instagram'));
  await h.close();
});

const processEnv = {
  INSTAGRAM_APP_ID: 'app1',
  INSTAGRAM_APP_SECRET: 'sekret',
  INSTAGRAM_REDIRECT_URI: 'https://box.test/api/v1/integrations/meta/instagram/callback',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-me',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

/** Fake Instagram: each code maps to a user id; tokens embed the id so profile lookups are consistent. */
function fakeInstagram(users: Record<string, { id: string; username: string }>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    calls.push(url);
    if (url.startsWith('https://api.instagram.com/oauth/access_token')) {
      const code = new URLSearchParams(String(init.body)).get('code')!;
      const u = users[code];
      if (!u) return json({ error_message: 'expired' }, 400);
      return json({
        data: [
          {
            access_token: `short-${u.id}`,
            user_id: u.id,
            permissions: 'instagram_business_basic,instagram_business_content_publish',
          },
        ],
      });
    }
    if (url.includes('/access_token?')) {
      const t = new URL(url).searchParams.get('access_token')!;
      return json({ access_token: t.replace('short', 'long'), expires_in: 5_184_000 });
    }
    if (url.includes('refresh_access_token')) {
      return json({ access_token: 'refreshed', expires_in: 5_184_000 });
    }
    if (url.includes('/me?') || url.includes('/me/')) {
      const t = new URL(url).searchParams.get('access_token') ?? '';
      const u = Object.values(users).find((x) => t.endsWith(x.id)) ?? Object.values(users)[0]!;
      return json({
        user_id: u.id,
        username: u.username,
        account_type: 'CREATOR',
        followers_count: 10,
        media_count: 3,
      });
    }
    return json({}, 404);
  };
  return { calls, overrides: { fetch: fetchImpl as any, sleep: async () => {} } };
}

async function begin(org: Awaited<ReturnType<typeof makeOrg>>, ov: any) {
  const s = await startOAuth(org.ctx, 'instagram', {}, ov);
  expect(s.status).toBe('REDIRECT');
  return new URL(s.authorizeUrl!).searchParams.get('state')!;
}

describe('Instagram Login connection', () => {
  it('connects an account, discovers the profile and never stores or exposes the token in clear', async () => {
    const env = testEnv({ processEnv });
    const org = await makeOrg(h, env);
    const ig = fakeInstagram({ codeA: { id: '111', username: 'mehak' } });
    const state = await begin(org, ig.overrides);
    const r = await completeOAuth(h.db, env, { state, code: 'codeA#_' }, ig.overrides);
    expect(r).toMatchObject({ provider: 'instagram', principal: '111' });

    const [row] = await h.db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, r.connectionId));
    expect(row!.state).toBe('ACTIVE');
    expect(row!.label).toBe('@mehak');
    expect(row!.encryptedTokenRef).toBeTruthy();
    expect(row!.encryptedTokenRef).not.toContain('long-111');
    expect(row!.scopes).toContain('instagram_business_content_publish');

    const list: any[] = await listIntegrations(org.ctx, ig.overrides);
    const insta = list.find((p) => p.provider === 'instagram');
    expect(JSON.stringify(list)).not.toContain('long-111');
    expect(insta.connections).toHaveLength(1);
    expect(insta.connections[0].account).toMatchObject({
      accountId: '111',
      username: 'mehak',
      capabilities: { importMedia: true, publish: true, comments: false, messages: false },
      missingPermissions: ['instagram_business_manage_comments', 'instagram_business_manage_messages'],
    });
    expect(insta.connections[0].account.token.status).toBe('OK');
  });

  it('rejects an invalid, reused or expired state and a denied authorization', async () => {
    const env = testEnv({ processEnv });
    const org = await makeOrg(h, env);
    const ig = fakeInstagram({ c1: { id: '1', username: 'a' } });
    await expect(completeOAuth(h.db, env, { state: 'nope', code: 'c1' }, ig.overrides)).rejects.toMatchObject(
      {
        code: 'OAUTH_STATE_INVALID',
      },
    );
    const s1 = await begin(org, ig.overrides);
    await completeOAuth(h.db, env, { state: s1, code: 'c1' }, ig.overrides);
    await expect(completeOAuth(h.db, env, { state: s1, code: 'c1' }, ig.overrides)).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });
    const s2 = await begin(org, ig.overrides);
    await h.db
      .update(oauthStates)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(sql`org_id = ${org.orgId}`);
    await expect(completeOAuth(h.db, env, { state: s2, code: 'c1' }, ig.overrides)).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });
    const s3 = await begin(org, ig.overrides);
    await expect(
      completeOAuth(h.db, env, { state: s3, error: 'access_denied' }, ig.overrides),
    ).rejects.toMatchObject({ code: 'OAUTH_DENIED' });
    const s4 = await begin(org, ig.overrides);
    await expect(
      completeOAuth(h.db, env, { state: s4, code: 'expired-code' }, ig.overrides),
    ).rejects.toThrow();
  });

  it('supports multiple accounts and de-duplicates a reconnect of the same account', async () => {
    const env = testEnv({ processEnv });
    const org = await makeOrg(h, env);
    const ig = fakeInstagram({
      a: { id: '111', username: 'mehak' },
      b: { id: '222', username: 'travel' },
    });
    const a1 = await completeOAuth(
      h.db,
      env,
      { state: await begin(org, ig.overrides), code: 'a' },
      ig.overrides,
    );
    const b = await completeOAuth(
      h.db,
      env,
      { state: await begin(org, ig.overrides), code: 'b' },
      ig.overrides,
    );
    const a2 = await completeOAuth(
      h.db,
      env,
      { state: await begin(org, ig.overrides), code: 'a' },
      ig.overrides,
    );
    expect(a2.connectionId).toBe(a1.connectionId);
    expect(b.connectionId).not.toBe(a1.connectionId);
    const rows = await h.db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.orgId, org.orgId));
    expect(rows.filter((r) => r.provider === 'instagram')).toHaveLength(2);
  });

  it('renews tokens that are close to expiry, marks expired ones, and leaves healthy ones alone', async () => {
    const env = testEnv({ processEnv });
    const org = await makeOrg(h, env);
    const ig = fakeInstagram({
      a: { id: '111', username: 'mehak' },
      b: { id: '222', username: 'travel' },
      c: { id: '333', username: 'old' },
    });
    const ids: string[] = [];
    for (const code of ['a', 'b', 'c'])
      ids.push(
        (await completeOAuth(h.db, env, { state: await begin(org, ig.overrides), code }, ig.overrides))
          .connectionId,
      );
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const setConn = (id: string, expires: Date) =>
      h.db
        .update(providerConnections)
        .set({
          expiresAt: expires,
          config: sql`jsonb_set(config, '{issuedAt}', to_jsonb(${old}::text))`,
        })
        .where(eq(providerConnections.id, id));
    await setConn(ids[0]!, new Date(Date.now() + 3 * 86_400_000)); // due for renewal
    await setConn(ids[1]!, new Date(Date.now() + 50 * 86_400_000)); // healthy
    await setConn(ids[2]!, new Date(Date.now() - 86_400_000)); // already expired
    const res = await renewInstagramTokens(h.db, env, ig.overrides);
    expect(res.renewed).toBeGreaterThanOrEqual(1);
    const get = async (id: string) =>
      (await h.db.select().from(providerConnections).where(eq(providerConnections.id, id)))[0]!;
    expect((await get(ids[0]!)).expiresAt!.getTime()).toBeGreaterThan(Date.now() + 50 * 86_400_000);
    expect((await get(ids[1]!)).expiresAt!.getTime()).toBeLessThan(Date.now() + 51 * 86_400_000);
    const expired = await get(ids[2]!);
    expect(expired.state).toBe('AUTH_EXPIRED');
    expect(expired.lastError).toMatch(/Reconnect/);
  });

  it('disconnect wipes the stored token and keeps the record', async () => {
    const env = testEnv({ processEnv });
    const org = await makeOrg(h, env);
    const ig = fakeInstagram({ a: { id: '111', username: 'mehak' } });
    const r = await completeOAuth(
      h.db,
      env,
      { state: await begin(org, ig.overrides), code: 'a' },
      ig.overrides,
    );
    await disconnect(org.ctx, r.connectionId, ig.overrides);
    const [row] = await h.db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, r.connectionId));
    expect(row!.encryptedTokenRef).toBeNull();
    expect(row!.state).toBe('NOT_CONFIGURED');
  });

  it('is NOT_CONFIGURED without the app settings (no fake redirect)', async () => {
    const env = testEnv({ processEnv: {} });
    const org = await makeOrg(h, env);
    const s = await startOAuth(org.ctx, 'instagram', {});
    expect(s.authorizeUrl).toBeNull();
    expect(s.status).toBe('NOT_CONFIGURED');
  });
});

describe('Meta webhooks', () => {
  const env = testEnv({ processEnv });
  const body = JSON.stringify({
    object: 'instagram',
    entry: [
      { id: 'unique-' + Math.random(), time: 1, changes: [{ field: 'comments', value: { text: 'hi' } }] },
    ],
  });
  const sign = (b: string, secret = 'sekret') =>
    'sha256=' + createHmac('sha256', secret).update(b).digest('hex');

  it('answers the hub challenge only for the configured verify token', () => {
    expect(
      verifyMetaHandshake(env, { mode: 'subscribe', verifyToken: 'verify-me', challenge: '12345' }),
    ).toBe('12345');
    expect(() =>
      verifyMetaHandshake(env, { mode: 'subscribe', verifyToken: 'wrong', challenge: '1' }),
    ).toThrow();
    expect(() =>
      verifyMetaHandshake(env, { mode: 'unsubscribe', verifyToken: 'verify-me', challenge: '1' }),
    ).toThrow();
    expect(() =>
      verifyMetaHandshake(testEnv({ processEnv: {} }), {
        mode: 'subscribe',
        verifyToken: 'x',
        challenge: '1',
      }),
    ).toThrow(/not configured/);
  });

  it('rejects bad signatures, stores valid events once, and ignores redelivery', async () => {
    await expect(receiveInstagramWebhook(h.db, env, body, sign(body, 'other'))).rejects.toMatchObject({
      status: 401,
    });
    await expect(receiveInstagramWebhook(h.db, env, body, undefined)).rejects.toMatchObject({ status: 401 });
    const first = await receiveInstagramWebhook(h.db, env, body, sign(body));
    expect(first).toMatchObject({ received: 1, stored: 1, duplicates: 0 });
    const again = await receiveInstagramWebhook(h.db, env, body, sign(body));
    expect(again).toMatchObject({ received: 1, stored: 0, duplicates: 1 });
    const rows = await h.db
      .select()
      .from(providerWebhookEvents)
      .where(eq(providerWebhookEvents.status, 'PENDING'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses oversized payloads before doing any work', async () => {
    const big = JSON.stringify({ object: 'instagram', entry: [{ pad: 'x'.repeat(300 * 1024) }] });
    await expect(receiveInstagramWebhook(h.db, env, big, sign(big))).rejects.toMatchObject({ status: 413 });
  });
});

describe('webhook entry shapes', () => {
  it('parses DMs delivered as changes[field=messages] as well as messaging[]', async () => {
    const { parseInstagramWebhookEntry } = await import('@creatoros/connectors');
    const ev = parseInstagramWebhookEntry({
      id: '178',
      time: 1792285164,
      changes: [
        {
          field: 'messages',
          value: {
            sender: { id: 'u1' },
            recipient: { id: '178' },
            timestamp: '1792285164',
            message: { mid: 'm-1', text: 'hi' },
          },
        },
      ],
    });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      kind: 'DM',
      providerMsgId: 'm-1',
      participantId: 'u1',
      direction: 'INBOUND',
    });
  });
});
