import { describe, expect, it } from 'vitest';
import { parseFacebookReactionCounts } from './meta/facebook';
import { instagramInsightPlan } from './meta/instagram';
import { indexYoutubeByVideo, youtubeChannelRow } from './google/youtube';

describe('platform metric plans', () => {
  it('does not ask Instagram for views on a photo', () => {
    const photo = instagramInsightPlan('IMAGE', 'FEED');
    expect(photo.core).not.toContain('views');
    expect(photo.core).toEqual(expect.arrayContaining(['reach', 'saved', 'likes', 'comments']));
    const reel = instagramInsightPlan('VIDEO', 'REELS');
    expect(reel.core).toContain('views');
    expect(reel.optional).toContain('ig_reels_avg_watch_time');
  });

  it('keeps Facebook reaction types as separate counts', () => {
    const counts = parseFacebookReactionCounts({
      data: [{ name: 'post_reactions_by_type_total', values: [{ value: { like: 4, love: 1, care: 2, anger: 0 } }] }],
    });
    expect(counts).toEqual({ reactionLike: 4, reactionLove: 1, reactionCare: 2, reactionAnger: 0 });
  });

  it('indexes YouTube analytics numbers by video and drops missing columns', () => {
    const byVideo = indexYoutubeByVideo([
      { video: 'abc', views: 10, estimatedMinutesWatched: 4 },
      { video: 'def', views: 0 },
    ]);
    expect(byVideo.get('abc')).toEqual({ views: 10, estimatedMinutesWatched: 4 });
    expect(byVideo.get('def')).toEqual({ views: 0 });
    expect(youtubeChannelRow([{ views: 80, estimatedMinutesWatched: 12 }])).toEqual({
      views: 80,
      estimatedMinutesWatched: 12,
    });
  });
});
