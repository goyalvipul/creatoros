import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseTikTokSignature, verifyTikTokSignature } from './tiktok-webhook';

const secret = 'client-secret';
const body = '{"client_key":"ck","event":"authorization.removed","create_time":1633174587,"user_openid":"openid","content":"{\\"reason\\":1}"}';
const now = 1_633_174_587_000;

function sign(raw: string, ts = '1633174587', key = secret) {
  const mac = createHmac('sha256', key).update(`${ts}.${raw}`).digest('hex');
  return `t=${ts},s=${mac}`;
}

describe('TikTok webhook signature', () => {
  it('accepts the official timestamp.rawBody HMAC', () => {
    expect(verifyTikTokSignature(secret, body, sign(body), now)).toBe(true);
  });

  it('rejects a wrong secret, a changed body, a stale timestamp, and a missing header', () => {
    expect(verifyTikTokSignature('other', body, sign(body), now)).toBe(false);
    expect(verifyTikTokSignature(secret, `${body} `, sign(body), now)).toBe(false);
    expect(verifyTikTokSignature(secret, body, sign(body, '1633174000'), now)).toBe(false);
    expect(verifyTikTokSignature(secret, body, undefined, now)).toBe(false);
    expect(parseTikTokSignature('t=1,s=abcd')).toBeNull();
  });
});
