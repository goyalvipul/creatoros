import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, providerConnections, providerWebhookEvents } from '@creatoros/db';
import { completeOAuth, encryptJson, processTikTokWebhookEvents, receiveTikTokWebhook, startOAuth } from '@creatoros/services';
import { makeOrg, openDb, testEnv } from '../src/helpers';

const h = openDb();
afterAll(async () => {
  await h.db.delete(providerWebhookEvents).where(eq(providerWebhookEvents.provider, 'tiktok'));
  await h.db.delete(providerConnections).where(eq(providerConnections.provider, 'tiktok'));
  await h.close();
});

const env = testEnv({ processEnv: { TIKTOK_CLIENT_SECRET: 'client-secret' } });
const now = 1_700_000_000_000;

function signed(body: unknown, secret = 'client-secret', ts = Math.floor(now / 1000)) {
  const raw = JSON.stringify(body);
  const mac = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return { raw, header: `t=${ts},s=${mac}` };
}

describe('TikTok webhooks', () => {
  it('stores a signed event once and rejects a bad signature', async () => {
    const body = {
      client_key: 'ck',
      event: 'post.publish.complete',
      create_time: 10,
      user_openid: 'nobody',
      content: JSON.stringify({ publish_id: 'pub-1', access_token: 'do-not-store' }),
    };
    const { raw, header } = signed(body);
    const first = await receiveTikTokWebhook(h.db, env, raw, header, now);
    const second = await receiveTikTokWebhook(h.db, env, raw, header, now);
    expect(first).toEqual({ received: 1, stored: 1, duplicates: 0 });
    expect(second).toEqual({ received: 1, stored: 0, duplicates: 1 });
    await expect(receiveTikTokWebhook(h.db, env, raw, 't=1,s=' + 'ab'.repeat(32), now)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    const [row] = await h.db
      .select()
      .from(providerWebhookEvents)
      .where(eq(providerWebhookEvents.provider, 'tiktok'));
    expect(JSON.stringify(row?.payload)).not.toContain('do-not-store');
    expect(JSON.stringify(row?.payload)).not.toContain('client-secret');
  });

  it('expires the matching TikTok connection when authorization is removed', async () => {
    const org = await makeOrg(h, env);
    const [conn] = await h.db
      .insert(providerConnections)
      .values({
        orgId: org.orgId,
        provider: 'tiktok',
        label: 'TikTok',
        principalHint: 'openid-9',
        encryptedTokenRef: encryptJson({ accessToken: 'tok' }, env.encryptionKey),
        state: 'ACTIVE',
        config: {},
      })
      .returning({ id: providerConnections.id });
    const body = {
      event: 'authorization.removed',
      create_time: 11,
      user_openid: 'openid-9',
      content: '{"reason":1}',
    };
    const { raw, header } = signed(body);
    await receiveTikTokWebhook(h.db, env, raw, header, now);
    const result = await processTikTokWebhookEvents(h.db);
    expect(result.processed).toBeGreaterThanOrEqual(1);
    const [saved] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, conn!.id));
    expect(saved?.state).toBe('AUTH_EXPIRED');
    expect(saved?.encryptedTokenRef).toBeNull();
    expect(saved?.lastError).toContain('disconnected');
    expect(saved?.lastError).not.toContain('openid-9');
    expect(saved?.lastError).not.toContain('tok');
  });

  it('connects through TikTok Login Kit and stores the token on the server', async () => {
    const oauthEnv = testEnv({
      appBaseUrl: 'https://os.example',
      processEnv: {
        TIKTOK_CLIENT_KEY: 'client-key',
        TIKTOK_CLIENT_SECRET: 'client-secret',
        TIKTOK_REDIRECT_URI: 'https://os.example/api/v1/integrations/tiktok/callback',
      },
    });
    const org = await makeOrg(h, oauthEnv);
    const fetchImpl = async (url: string) => {
      if (url.includes('/oauth/token'))
        return new Response(
          JSON.stringify({
            access_token: 'at-secret',
            refresh_token: 'rt-secret',
            expires_in: 86400,
            scope: 'user.info.basic,video.list',
            open_id: 'oid-1',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      if (url.includes('/user/info'))
        return new Response(
          JSON.stringify({ data: { user: { open_id: 'oid-1', display_name: 'Mehak' } }, error: { code: 'ok' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      return new Response('no', { status: 404 });
    };
    const started = await startOAuth(org.ctx, 'tiktok', {}, { fetch: fetchImpl });
    const state = new URL(started.authorizeUrl!).searchParams.get('state');
    expect(started.authorizeUrl).toContain('https://www.tiktok.com/v2/auth/authorize/');
    expect(started.authorizeUrl).toContain(
      encodeURIComponent('https://os.example/api/v1/integrations/tiktok/callback'),
    );
    const done = await completeOAuth(h.db, oauthEnv, { state: state!, code: 'auth-code' }, { fetch: fetchImpl });
    expect(done.provider).toBe('tiktok');
    const [saved] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, done.connectionId));
    expect(saved?.label).toBe('Mehak');
    expect(saved?.principalHint).toBe('oid-1');
    expect(JSON.stringify(saved?.config)).not.toContain('at-secret');
    expect(saved?.encryptedTokenRef).toBeTruthy();
  });
});
