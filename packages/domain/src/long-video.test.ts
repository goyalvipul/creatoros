import { describe, expect, it } from 'vitest';
import { generationSeconds, planGenerationGroups, planScenes, spansCover, type GenerationScene } from './long-video';

describe('long video scenes', () => {
  it('splits a song into 10 second scenes, including a short ending', () => {
    const scenes = planScenes(123_000, 10_000);
    expect(scenes).toHaveLength(13);
    expect(scenes[0]).toEqual({ startMs: 0, endMs: 10_000 });
    expect(scenes[12]).toEqual({ startMs: 120_000, endMs: 123_000 });
    expect(spansCover(123_000, scenes)).toBe(true);
  });

  it('counts a 20 second song as two scenes and a 21 second song as three', () => {
    expect(planScenes(20_000)).toHaveLength(2);
    expect(planScenes(21_000)).toHaveLength(3);
    expect(planScenes(3_000)[0]).toEqual({ startMs: 0, endMs: 3_000 });
  });

  it('joins context scenes into one job and starts again at the next shot', () => {
    const scenes: GenerationScene[] = [
      { id: 's1', continuity: 'shot', status: 'DRAFT' },
      { id: 's2', continuity: 'context', status: 'DRAFT' },
      { id: 's3', continuity: 'context', status: 'DRAFT' },
      { id: 's4', continuity: 'shot', status: 'DRAFT' },
      { id: 's5', continuity: 'context', status: 'DRAFT' },
    ];
    expect(planGenerationGroups(scenes, 'all')).toEqual([['s1', 's2', 's3'], ['s4', 's5']]);
    expect(planGenerationGroups(scenes, 'one', 's4')).toEqual([['s4']]);
    expect(planGenerationGroups(scenes, 'one', 's5')).toEqual([['s4', 's5']]);
  });

  it('leaves a finished scene out and caps a group at 8', () => {
    const scenes: GenerationScene[] = [
      { id: 's1', continuity: 'shot', status: 'READY' },
      ...Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, continuity: 'context' as const, status: 'DRAFT' })),
    ];
    expect(planGenerationGroups(scenes, 'all')).toEqual([
      ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
      ['c8'],
    ]);
  });

  it('asks MiniMax for at least 4 seconds and never more than 15', () => {
    expect(generationSeconds(3_200).requestSec).toBe(4);
    expect(generationSeconds(10_000).requestSec).toBe(10);
    expect(generationSeconds(10_100).requestSec).toBe(11);
    expect(generationSeconds(20_000).note).toMatch(/15 seconds/);
  });
});
