import { describe, expect, it } from 'vitest';
import { oauthScopes } from './oauth-permissions';

describe('oauth permission picker', () => {
  it('asks only for the required permission when nothing else is chosen', () => {
    expect(oauthScopes('instagram', [])).toEqual(['instagram_business_basic']);
    expect(oauthScopes('threads')).toEqual(['threads_basic']);
    expect(oauthScopes('facebook', ['read_insights', 'not_a_scope'])).toEqual(['pages_show_list', 'read_insights']);
    expect(oauthScopes('tiktok', ['video.publish', 'nope'])).toEqual(['user.info.basic', 'video.publish']);
    expect(oauthScopes('snapchat', [])).toEqual([]);
    expect(oauthScopes('snapchat', ['snapchat-profile-api', 'snapchat-marketing-api'])).toEqual(['snapchat-profile-api']);
  });
});
