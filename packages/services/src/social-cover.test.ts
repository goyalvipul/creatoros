import { describe, expect, it } from 'vitest';
import { signSocialCoverToken, verifySocialCoverToken } from './social-cover';

const org = '11111111-1111-4111-8111-111111111111';
const item = '22222222-2222-4222-8222-222222222222';
const account = '33333333-3333-4333-8333-333333333333';
const secret = 'test-social-cover-signing-secret';

describe('social-specific thumbnail download tokens', () => {
  it('binds account, file, organization and expiry', () => {
    const token = signSocialCoverToken(secret, org, item, account, 900000);
    expect(verifySocialCoverToken(secret, token, 800000)).toEqual({ orgId: org, itemId: item, accountId: account });
    expect(verifySocialCoverToken(secret, token, 900001)).toBeNull();
  });
  it('rejects changes and different secrets', () => {
    const token = signSocialCoverToken(secret, org, item, account, 900000);
    expect(verifySocialCoverToken('other-secret', token, 800000)).toBeNull();
    expect(verifySocialCoverToken(secret, token.replace(/.$/, 'A'), 800000)).toBeNull();
  });
});
