import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signMediaToken, verifyMediaToken } from './crypto';

const key = 'a-long-random-media-signature-key';
const one = {
  instanceId: '00000000-0000-4000-8000-000000000001',
  orgId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
};

describe('organization-scoped signed media URLs', () => {
  const now = 1_700_000_000_000;

  it('only accepts the signed instance, organization, user and expiry', () => {
    const token = signMediaToken(key, { ...one, exp: now + 60_000 });
    expect(verifyMediaToken(key, token, now)).toEqual(one);
    expect(verifyMediaToken('another-signing-key', token, now)).toBeNull();
    expect(verifyMediaToken(key, token + 'a', now)).toBeNull();
  });

  it('rejects expired or excessively future-dated links', () => {
    expect(verifyMediaToken(key, signMediaToken(key, { ...one, exp: now - 1 }), now)).toBeNull();
    expect(verifyMediaToken(key, signMediaToken(key, { ...one, exp: now + 31 * 60_000 }), now)).toBeNull();
  });

  it('rejects legacy unscoped media tokens', () => {
    const payload = `${one.instanceId}.${one.userId}.${now + 60_000}`;
    const signature = createHmac('sha256', key).update(payload).digest('hex');
    expect(verifyMediaToken(key, `${Buffer.from(payload).toString('base64url')}.${signature}`, now)).toBeNull();
  });

  it('rejects malformed and missing expiry', () => {
    expect(verifyMediaToken(key, '', now)).toBeNull();
    expect(verifyMediaToken(key, 'a.b.c', now)).toBeNull();
    expect(verifyMediaToken(key, 'a.'.repeat(3000), now)).toBeNull();
  });
});
