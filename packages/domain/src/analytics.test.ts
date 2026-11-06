import { describe, expect, it } from 'vitest';
import {
  buildPublicProjection,
  classifyMetric,
  connectorCapabilities,
  projectionHasSecrets,
  ruleRecommendations,
} from './analytics';

describe('analytics metrics', () => {
  it('keeps a real zero distinct from a metric the platform did not return', () => {
    expect(classifyMetric(0, true)).toEqual({ state: 'ZERO', value: 0 });
    expect(classifyMetric(null, true)).toEqual({ state: 'UNKNOWN', value: null });
    expect(classifyMetric(12, false)).toEqual({ state: 'UNAVAILABLE', value: null });
  });

  it('does not treat Instagram basic access as permission to read views', () => {
    const caps = connectorCapabilities('INSTAGRAM', ['instagram_business_basic']);
    expect(caps.find((c) => c.metric === 'views')?.status).toBe('MISSING_PERMISSION');
    expect(caps.find((c) => c.metric === 'likes')?.status).toBe('AVAILABLE');
    const withInsights = connectorCapabilities('INSTAGRAM', [
      'instagram_business_basic',
      'instagram_business_manage_insights',
    ]);
    expect(withInsights.find((c) => c.metric === 'views')?.status).toBe('AVAILABLE');
    expect(withInsights.find((c) => c.metric === 'saves')?.status).toBe('AVAILABLE');
    expect(withInsights.find((c) => c.metric === 'shares')?.status).toBe('AVAILABLE');
    expect(withInsights.find((c) => c.metric === 'demographics')?.status).toBe('AVAILABLE');
    expect(withInsights.find((c) => c.metric === 'reach')?.additive).toBe(false);
  });

  it('marks YouTube watch time unavailable without the analytics scope', () => {
    const caps = connectorCapabilities('YOUTUBE', ['https://www.googleapis.com/auth/youtube.readonly']);
    expect(caps.find((c) => c.metric === 'views')?.status).toBe('AVAILABLE');
    expect(caps.find((c) => c.metric === 'watch_time')?.status).toBe('MISSING_PERMISSION');
  });

  it('marks Facebook views unavailable without read_insights', () => {
    const caps = connectorCapabilities('FACEBOOK', ['pages_read_engagement']);
    expect(caps.find((c) => c.metric === 'reactions')?.status).toBe('AVAILABLE');
    expect(caps.find((c) => c.metric === 'views')?.status).toBe('MISSING_PERMISSION');
  });

  it('does not invent TikTok or Threads numbers', () => {
    expect(connectorCapabilities('TIKTOK', []).every((c) => c.status === 'NOT_CONNECTED')).toBe(true);
    expect(connectorCapabilities('THREADS', null).every((c) => c.status === 'NOT_CONNECTED')).toBe(true);
    const threads = connectorCapabilities('THREADS', ['threads_basic', 'threads_manage_insights']);
    expect(threads.find((c) => c.metric === 'views')?.status).toBe('AVAILABLE');
    expect(threads.find((c) => c.metric === 'likes')?.status).toBe('AVAILABLE');
    expect(connectorCapabilities('THREADS', ['threads_basic']).find((c) => c.metric === 'views')?.status).toBe(
      'MISSING_PERMISSION',
    );
  });

  it('builds recommendations only from posts that have views, and does not call them proven', () => {
    const posts = [10, 12, 11, 400, 380].map((views, i) => ({
      id: `p${i}`,
      title: `Clip ${i}`,
      platform: 'YOUTUBE',
      views,
      publishedAt: '2026-10-01T00:00:00Z',
    }));
    const recs = ruleRecommendations(posts, { from: '2026-10-01', to: '2026-11-01' });
    expect(recs).toHaveLength(1);
    expect(recs[0]?.proven).toBe(false);
    expect(recs[0]?.sampleSize).toBe(5);
    expect(recs[0]?.hypothesis.toLowerCase()).toContain('not proof');
  });

  it('refuses to publish a follower number the browser supplied, and strips secrets', () => {
    const kit = buildPublicProjection({
      artistName: 'Mehak',
      positioning: 'Singer',
      bio: 'Bio',
      photos: [{ url: 'https://example.com/a.jpg', alt: 'Mehak' }],
      showFollowers: true,
      showTopContent: true,
      platforms: [
        {
          platform: 'INSTAGRAM',
          handle: '@mehakviking',
          url: 'https://www.instagram.com/mehakviking/',
          followers: { state: 'UNAVAILABLE', value: null },
          source: null,
          updatedAt: null,
        },
      ],
      topContent: [],
      collaborations: [{ name: 'A brand', note: '2026' }],
      contactEmail: 'hello@example.com',
      periodLabel: 'Latest sync',
      updatedAt: null,
    });
    expect(kit.platforms[0]?.followers).toBeNull();
    expect(kit.platforms[0]?.followersState).toBe('UNAVAILABLE');
    expect(projectionHasSecrets(kit)).toBe(false);
    expect(projectionHasSecrets({ accessToken: 'x' })).toBe(true);
  });
});
