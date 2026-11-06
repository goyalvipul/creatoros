import { describe, expect, it } from 'vitest';
import { processTikTokWebhookEvents, sanitizeTikTokValue, tiktokWebhookPayload } from './tiktok-webhooks';

describe('TikTok webhook handling', () => {
  it('keeps the event fields and drops credential-like keys', () => {
    const payload = tiktokWebhookPayload({
      event: 'post.publish.failed',
      create_time: 10,
      user_openid: 'openid-1',
      content: JSON.stringify({ publish_id: 'p1', access_token: 'secret-value', fail_reason: 'x' }),
    });
    expect(payload.event).toBe('post.publish.failed');
    expect(payload.content).toEqual({ publish_id: 'p1', fail_reason: 'x' });
    expect(JSON.stringify(sanitizeTikTokValue({ client_secret: 'nope', reason: 1 }))).not.toContain('nope');
  });

  it('records a handler error without the account id', async () => {
    const seen: Record<string, unknown>[] = [];
    const db = {
      execute: async () => ({
        rows: [
          {
            id: 'e1',
            payload: { event: 'authorization.removed', user_openid: 'openid-1', content: { reason: 1 } },
          },
        ],
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            const run = Promise.resolve().then(() => {
              if (values.encryptedTokenRef === null) throw new Error('db write failed');
              seen.push(values);
            });
            return Object.assign(run, { returning: () => run });
          },
        }),
      }),
    };
    const result = await processTikTokWebhookEvents(db as never);
    expect(result).toEqual({ processed: 0, ignored: 0, failed: 1 });
    expect(seen).toEqual([{ status: 'FAILED', processedAt: expect.any(Date), error: 'HANDLER_FAILED' }]);
    expect(JSON.stringify(seen)).not.toContain('openid-1');
  });
});
