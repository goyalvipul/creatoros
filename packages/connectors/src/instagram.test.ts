import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ConnectorError,
  InstagramLoginConnector,
  buildInstagramAuthUrl,
  exchangeInstagramCode,
  instagramCapabilityMatrix,
  isGraphUrl,
  refreshInstagramToken,
  verifyMetaSignature,
  type ConnectorContext,
} from './index';

const client = {
  appId: 'app1',
  appSecret: 'sekret',
  redirectUri: 'https://x.test/api/v1/integrations/meta/instagram/callback',
  graphVersion: 'v23.0',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function ctxWith(
  handler: (url: string, init: RequestInit) => Response,
  over: Partial<ConnectorContext> = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const ctx: ConnectorContext = {
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      return handler(url, init);
    },
    now: () => 1_800_000_000_000,
    credentials: {},
    config: { instagramClient: client },
    sleep: async () => {},
    ...over,
  };
  return { ctx, calls };
}

describe('Instagram Login connector', () => {
  it('builds an authorize URL with only instagram_business_* scopes and no Facebook Login params', () => {
    const u = new URL(
      buildInstagramAuthUrl({
        client,
        scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
        state: 'st',
      }),
    );
    expect(u.origin + u.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(u.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_content_publish');
    expect(u.searchParams.get('scope')).not.toMatch(/pages_|instagram_basic|instagram_content_publish/);
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('redirect_uri')).toBe(client.redirectUri);
  });

  it('connect() redirects when configured and reports NOT_CONFIGURED otherwise', async () => {
    const c = new InstagramLoginConnector();
    const ok = await c.connect(ctxWith(() => json({})).ctx);
    expect(ok.status).toBe('REDIRECT');
    expect(ok.oauth?.scopes).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
      'instagram_business_manage_messages',
    ]);
    const none = await c.connect(ctxWith(() => json({}), { config: {} }).ctx);
    expect(none.status).toBe('NOT_CONFIGURED');
    expect(none.steps?.length).toBeGreaterThan(0);
  });

  it('exchanges the code (strips #_), upgrades to a long-lived token and records permissions', async () => {
    const { ctx, calls } = ctxWith((url) =>
      url.startsWith('https://api.instagram.com/oauth/access_token')
        ? json({
            data: [
              {
                access_token: 'short',
                user_id: 1789,
                permissions: 'instagram_business_basic,instagram_business_content_publish',
              },
            ],
          })
        : json({ access_token: 'long', token_type: 'bearer', expires_in: 5_184_000 }),
    );
    const creds = await exchangeInstagramCode(ctx, client, 'abc#_');
    expect(creds.accessToken).toBe('long');
    expect(creds.principal).toBe('1789');
    expect(creds.scopes).toEqual(['instagram_business_basic', 'instagram_business_content_publish']);
    expect(creds.expiresAt).toBe(1_800_000_000_000 + 5_184_000_000);
    expect(String(calls[0]!.init.body)).toContain('code=abc');
    expect(String(calls[0]!.init.body)).not.toContain('%23_');
    expect(calls[1]!.url).toContain('graph.instagram.com/access_token');
    expect(calls[1]!.url).toContain('grant_type=ig_exchange_token');
  });

  it('rejects an expired / reused code without a retry storm', async () => {
    const { ctx, calls } = ctxWith(() =>
      json({ error_type: 'OAuthException', error_message: 'code expired' }, 400),
    );
    await expect(exchangeInstagramCode(ctx, client, 'old')).rejects.toBeInstanceOf(ConnectorError);
    expect(calls).toHaveLength(1);
  });

  it('refreshes a token and maps rejection to AUTH_REVOKED', async () => {
    const good = ctxWith(() => json({ access_token: 'new', expires_in: 100 }), {
      credentials: { accessToken: 'old', scopes: ['instagram_business_basic'] },
    });
    const fresh = await refreshInstagramToken(good.ctx);
    expect(fresh.accessToken).toBe('new');
    expect(fresh.scopes).toEqual(['instagram_business_basic']);
    const bad = ctxWith(() => json({ error: { message: 'expired' } }, 400), {
      credentials: { accessToken: 'old' },
    });
    await expect(refreshInstagramToken(bad.ctx)).rejects.toMatchObject({ kind: 'AUTH_REVOKED' });
  });

  it('gates capabilities on granted permissions and lists the missing ones', async () => {
    expect(instagramCapabilityMatrix(['instagram_business_basic']).flags).toMatchObject({
      importMedia: true,
      publish: false,
      comments: false,
      messages: false,
    });
    const m = instagramCapabilityMatrix(['instagram_business_basic', 'instagram_business_content_publish']);
    expect(m.flags.publish).toBe(true);
    expect(m.missing).toEqual(['instagram_business_manage_comments', 'instagram_business_manage_messages']);
    // publish without basic is not usable
    expect(instagramCapabilityMatrix(['instagram_business_content_publish']).flags.publish).toBe(false);
    const caps = await new InstagramLoginConnector().getCapabilities(
      ctxWith(() => json({}), { credentials: { accessToken: 't', scopes: ['instagram_business_basic'] } })
        .ctx,
    );
    expect(caps.write).toBe(false);
    expect(caps.blockers.join(' ')).toContain('instagram_business_content_publish');
  });

  it('health maps a revoked token to AUTH_EXPIRED', async () => {
    const r = await new InstagramLoginConnector().health(
      ctxWith(() => json({ error: { message: 'bad token' } }, 401), { credentials: { accessToken: 'x' } })
        .ctx,
    );
    expect(r).toMatchObject({ ok: false, state: 'AUTH_EXPIRED' });
  });

  it('only follows pagination links on graph.instagram.com (SSRF guard)', async () => {
    expect(isGraphUrl('https://graph.instagram.com/v23.0/me/media?after=1')).toBe(true);
    expect(isGraphUrl('http://graph.instagram.com/x')).toBe(false);
    expect(isGraphUrl('https://evil.test/graph.instagram.com')).toBe(false);
    expect(isGraphUrl('https://graph.instagram.com@evil.test/')).toBe(false);
    expect(isGraphUrl('https://169.254.169.254/')).toBe(false);
    const { ctx, calls } = ctxWith(
      (url) =>
        url.includes('/me/media')
          ? json({
              data: [{ id: '1', permalink: 'https://instagram.com/p/1', timestamp: '2026-01-01T00:00:00Z' }],
              paging: { next: 'https://169.254.169.254/steal' },
            })
          : json({}),
      { credentials: { accessToken: 't' } },
    );
    const r = await new InstagramLoginConnector().syncFull(ctx);
    expect(r.items).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe('Meta webhook signature', () => {
  const body = '{"object":"instagram","entry":[]}';
  const sig = 'sha256=' + createHmac('sha256', 'sekret').update(body).digest('hex');
  it('accepts a valid signature and rejects tampering, wrong secret and missing header', () => {
    expect(verifyMetaSignature(body, sig, 'sekret')).toBe(true);
    expect(verifyMetaSignature(body + ' ', sig, 'sekret')).toBe(false);
    expect(verifyMetaSignature(body, sig, 'other')).toBe(false);
    expect(verifyMetaSignature(body, undefined, 'sekret')).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=zz', 'sekret')).toBe(false);
  });
});
