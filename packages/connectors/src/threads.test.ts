import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildThreadsAuthUrl,
  parseThreadsInsightValues,
  parseThreadsSignedRequest,
  readThreadsClientConfig,
  threadsCallbackUrls,
  threadsCapabilityMatrix,
} from './meta/threads';

function signed(payload: unknown, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${sig}.${body}`;
}

describe('Threads login', () => {
  it('uses the Facebook app when no Threads app id is set, and builds the live redirect', () => {
    const client = readThreadsClientConfig(
      { FACEBOOK_APP_ID: 'meta-app', FACEBOOK_APP_SECRET: 'meta-secret' },
      'https://os.goyalfamily.ca',
    );
    expect(client).toEqual({
      appId: 'meta-app',
      appSecret: 'meta-secret',
      redirectUri: 'https://os.goyalfamily.ca/api/v1/integrations/threads/callback',
    });
    const url = new URL(buildThreadsAuthUrl({ client: client!, scopes: ['threads_basic', 'threads_manage_insights'], state: 'abc' }));
    expect(url.origin + url.pathname).toBe('https://threads.net/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('threads_basic,threads_manage_insights');
    expect(url.searchParams.get('redirect_uri')).toBe(client!.redirectUri);
    expect(url.searchParams.get('client_id')).toBe('meta-app');
  });

  it('prefers a dedicated Threads app id and does not treat basic access as insights', () => {
    const client = readThreadsClientConfig(
      {
        FACEBOOK_APP_ID: 'meta-app',
        FACEBOOK_APP_SECRET: 'meta-secret',
        THREADS_APP_ID: 'threads-app',
        THREADS_APP_SECRET: 'threads-secret',
        THREADS_REDIRECT_URI: 'https://os.goyalfamily.ca/api/v1/integrations/threads/callback',
      },
      'https://os.goyalfamily.ca',
    );
    expect(client?.appId).toBe('threads-app');
    expect(client?.appSecret).toBe('threads-secret');
    expect(threadsCapabilityMatrix(['threads_basic']).flags).toMatchObject({ importMedia: true, insights: false, publish: false });
    expect(threadsCapabilityMatrix([
      'threads_basic',
      'threads_content_publish',
      'threads_delete',
      'threads_manage_insights',
      'threads_manage_mentions',
      'threads_manage_replies',
      'threads_profile_discovery',
      'threads_read_replies',
      'threads_share_to_instagram',
    ]).flags).toMatchObject({
      importMedia: true,
      insights: true,
      publish: true,
      delete: true,
      mentions: true,
      manageReplies: true,
      discovery: true,
      readReplies: true,
      shareToInstagram: true,
    });
    expect(parseThreadsInsightValues({ data: [{ name: 'views', total_value: { value: 12 } }, { name: 'likes', values: [{ value: 3 }] }] })).toEqual({
      views: 12,
      likes: 3,
    });
  });

  it('accepts a Threads signed request and rejects a changed body', () => {
    const secret = 'app-secret';
    const good = signed({ algorithm: 'HMAC-SHA256', user_id: '1789' }, secret);
    expect(parseThreadsSignedRequest(good, secret)).toEqual({ userId: '1789' });
    expect(parseThreadsSignedRequest(good, 'other-secret')).toBeNull();
    expect(parseThreadsSignedRequest(`${good}x`, secret)).toBeNull();
    expect(threadsCallbackUrls('https://os.goyalfamily.ca/api/v1/integrations/threads/callback')).toEqual({
      deauthorize: 'https://os.goyalfamily.ca/api/v1/integrations/threads/deauthorize',
      dataDeletion: 'https://os.goyalfamily.ca/api/v1/integrations/threads/data-deletion',
    });
  });
});
