import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '@creatoros/api';
import { redactUrl, scrubText } from '../../../apps/api/src/log-redact';
import { openDb, testConfig } from '../src/helpers';

const h = openDb();
afterAll(async () => h.close());

const SECRETS = ['vt-SECRET-123', 'chal-456', 'oauth-code-789', 'tok-abc', 'sekret-zzz'];
const none = (text: string) => {
  for (const s of SECRETS) expect(text).not.toContain(s);
};

describe('log redaction', () => {
  it('drops the whole query for webhook paths and redacts dotted and underscored names elsewhere', () => {
    const w = '/api/v1/integrations/meta/instagram/webhook';
    expect(redactUrl(`${w}?hub.mode=subscribe&hub.verify_token=vt-SECRET-123&hub.challenge=chal-456`)).toBe(
      w,
    );
    expect(redactUrl(`${w}?hub_mode=subscribe&hub_verify_token=vt-SECRET-123&hub_challenge=chal-456`)).toBe(
      w,
    );
    const u = redactUrl(
      '/api/v1/integrations/meta/instagram/callback?code=oauth-code-789&state=tok-abc&hub.verify_token=vt-SECRET-123&hub_verify_token=vt-SECRET-123&client_secret=sekret-zzz&page=2',
    );
    none(u);
    expect(u).toContain('page=2');
    expect(u).toContain('code=REDACTED');
    expect(redactUrl('/x?Access_Token=tok-abc&MY_API_TOKEN=tok-abc')).not.toContain('tok-abc');
    expect(redactUrl('/plain')).toBe('/plain');
    expect(redactUrl(undefined)).toBe('');
  });

  it('scrubs tokens from free text (error messages, stack traces, diagnostics)', () => {
    none(
      scrubText(
        'GET https://x/y?hub.verify_token=vt-SECRET-123&access_token=tok-abc&client_secret=sekret-zzz failed; Bearer tok-abc',
      ),
    );
  });

  it('real request, access and error logs never contain the verification token, OAuth values or secrets', async () => {
    const lines: string[] = [];
    const config = testConfig(process.env.TEST_DATABASE_URL!, {
      LOG_LEVEL: 'info',
      INSTAGRAM_APP_ID: 'app1',
      INSTAGRAM_APP_SECRET: 'sekret-zzz',
      INSTAGRAM_REDIRECT_URI: 'https://box.test/cb',
      META_WEBHOOK_VERIFY_TOKEN: 'vt-SECRET-123',
    });
    const app = await buildApp(
      { db: h.db, config },
      { logStream: { write: (m: string) => void lines.push(m) } },
    );
    await app.ready();
    const w = '/api/v1/integrations/meta/instagram/webhook';
    const ok = await app.inject({
      method: 'GET',
      url: `${w}?hub.mode=subscribe&hub.verify_token=vt-SECRET-123&hub.challenge=chal-456&hub_verify_token=vt-SECRET-123`,
    });
    expect(ok.statusCode).toBe(200);
    await app.inject({
      method: 'GET',
      url: `${w}?hub.mode=subscribe&hub.verify_token=wrong-SECRET&hub.challenge=chal-456`,
    });
    await app.inject({
      method: 'POST',
      url: `${w}?access_token=tok-abc`,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' },
      payload: '{"object":"instagram","entry":[]}',
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/meta/instagram/callback?code=oauth-code-789&state=tok-abc&error=denied',
    });
    await app.close();
    const all = lines.join('');
    expect(all.length).toBeGreaterThan(0);
    none(all);
    expect(all).not.toContain('wrong-SECRET');
    expect(all).not.toContain('verify_token');
    const rec = lines.map((l) => JSON.parse(l)).find((l) => l.req?.url?.endsWith('/webhook'));
    expect(rec.req.url).toBe(w);
    expect(rec.req.headers).toBeUndefined();
  });
});
