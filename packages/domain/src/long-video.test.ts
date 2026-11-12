import { describe, expect, it } from 'vitest';
import { clipPlanCard, clipTitle, generationSeconds, isDefaultClipTitle, longVideoOutputFolder, orderByPlanName, parseClipPlan, planGenerationGroups, planScenes, resizeSceneSpan, spansCover, spansFromClipSeconds, type GenerationScene } from './long-video';

describe('long video scenes', () => {
  it('reads a clip plan and shares only pictures used on every clip', () => {
    const prompt = 'Line "one"\n<Picture 1> = Mehak\n🎵';
    const parsed = parseClipPlan([
      {
        clip_name: 'Airport intro',
        images_attached: 'Face.png, outfit.png, airport.png',
        clip_duration: 8,
        vocal: 'yes',
        prompt,
        song_details: "I don't care",
        image_details: '<Picture 1> = Mehak face identity',
      },
      {
        clip_name: 'Street',
        images_attached: ['face.png', 'street.png'],
        clip_duration: '6s',
        vocal: 'no',
        prompt: 'B-roll of the street',
        song_details: 'next line',
        image_details: '<Picture 2> = street',
      },
    ]);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.plan.clips[0]?.prompt).toBe(prompt);
    expect(parsed.plan.clips[0]?.vocal).toBe(true);
    expect(parsed.plan.clips[1]?.vocal).toBe(false);
    expect(parsed.plan.globalImages).toEqual(['Face.png']);
    expect(parsed.plan.clips[1]?.images).toEqual(['face.png', 'street.png']);
    const laid = spansFromClipSeconds(16_000, parsed.plan.clips.map((clip) => clip.durationSec));
    if ('error' in laid) throw new Error(laid.error);
    expect(laid.spans).toEqual([
      { startMs: 0, endMs: 8_000 },
      { startMs: 8_000, endMs: 14_000 },
    ]);
    expect(laid.songDifferenceMs).toBe(-2_000);
    expect('error' in spansFromClipSeconds(16_000, [10, 8])).toBe(false);
    expect(spansFromClipSeconds(16_000, [10, 10])).toEqual({ error: 'The clips run 4.0 seconds past the song. They can run up to 3 seconds past it.' });
    const ordered = orderByPlanName(
      [
        { id: 'street', name: 'street.png' },
        { id: 'face', name: 'FACE.PNG' },
      ],
      ['face.png', 'street.png'],
    );
    expect(ordered.map((item) => item.id)).toEqual(['face', 'street']);
    expect(clipPlanCard(5_000)).toBe('3060');
    expect(clipPlanCard(5_001)).toBe('3090');
  });

  it('names a new section clip 01 and keeps a title the owner typed', () => {
    expect(clipTitle(1)).toBe('clip 01');
    expect(clipTitle(12)).toBe('clip 12');
    expect(isDefaultClipTitle('clip 02')).toBe(true);
    expect(isDefaultClipTitle('Airport intro')).toBe(false);
  });

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

  it('slides the song boundary into the next section and keeps the song whole', () => {
    const song = [
      { startMs: 0, endMs: 10_000 },
      { startMs: 10_000, endMs: 20_000 },
      { startMs: 20_000, endMs: 25_000 },
    ];
    const shorter = resizeSceneSpan(song, 0, 8_000);
    expect(shorter).toEqual({
      spans: [
        { startMs: 0, endMs: 8_000 },
        { startMs: 8_000, endMs: 20_000 },
        { startMs: 20_000, endMs: 25_000 },
      ],
    });
    const longer = resizeSceneSpan(song, 0, 12_000);
    expect(longer).toEqual({
      spans: [
        { startMs: 0, endMs: 12_000 },
        { startMs: 12_000, endMs: 20_000 },
        { startMs: 20_000, endMs: 25_000 },
      ],
    });
    if (!('spans' in shorter) || !('spans' in longer)) throw new Error('expected spans');
    expect(spansCover(25_000, shorter.spans)).toBe(true);
    expect(spansCover(25_000, longer.spans)).toBe(true);
    const last = resizeSceneSpan(song, 2, 7_000);
    expect(last).toEqual({
      spans: [
        { startMs: 0, endMs: 10_000 },
        { startMs: 10_000, endMs: 18_000 },
        { startMs: 18_000, endMs: 25_000 },
      ],
    });
  });

  it('names the PC folder from the project, with _longvideo on the end', () => {
    expect(longVideoOutputFolder('Price Tag')).toBe('Price_Tag_longvideo');
    expect(longVideoOutputFolder('  ')).toBe('video_longvideo');
    expect(longVideoOutputFolder('Already_longvideo')).toBe('Already_longvideo');
  });

  it('asks MiniMax for at least 4 seconds and never more than 15', () => {
    expect(generationSeconds(3_200).requestSec).toBe(4);
    expect(generationSeconds(10_000).requestSec).toBe(10);
    expect(generationSeconds(10_100).requestSec).toBe(11);
    expect(generationSeconds(20_000).note).toMatch(/15 seconds/);
  });
});
