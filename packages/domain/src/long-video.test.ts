import { describe, expect, it } from 'vitest';
import { clipPlanCard, clipTitle, generationSeconds, h3RequestSeconds, isDefaultClipTitle, longVideoOutputFolder, motionVideoRange, orderByPlanName, parseClipPlan, planGenerationGroups, planScenes, resizeSceneSpan, songSpansForClips, spansCover, spansFromClipSeconds, type GenerationScene, type MotionTrackPlan } from './long-video';

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
    expect('error' in spansFromClipSeconds(16_000, [10, 10])).toBe(false);
    expect(spansFromClipSeconds(16_000, [20, 12])).toEqual({ error: 'The clips run 16.0 seconds past the song. They can run up to 15 seconds past it.' });
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
    expect(
      planGenerationGroups(
        [
          { id: 'done', continuity: 'shot', status: 'DRAFT', hasVideo: true },
          { id: 'next', continuity: 'context', status: 'DRAFT' },
          { id: 'busy', continuity: 'shot', status: 'RUNNING', hasVideo: true },
          { id: 'wait', continuity: 'shot', status: 'FAILED' },
        ],
        'all',
      ),
    ).toEqual([['next'], ['wait']]);
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
      removed: [],
      tradedWithPrevious: false,
    });
    const longer = resizeSceneSpan(song, 0, 12_000);
    expect(longer).toEqual({
      spans: [
        { startMs: 0, endMs: 12_000 },
        { startMs: 12_000, endMs: 20_000 },
        { startMs: 20_000, endMs: 25_000 },
      ],
      removed: [],
      tradedWithPrevious: false,
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
      removed: [],
      tradedWithPrevious: true,
    });
  });

  it('removes a section that is fully consumed and cascades into the one after it', () => {
    const song = [
      { startMs: 0, endMs: 10_000 },
      { startMs: 10_000, endMs: 20_000 },
      { startMs: 20_000, endMs: 30_000 },
    ];
    expect(resizeSceneSpan(song, 0, 20_000)).toEqual({
      spans: [
        { startMs: 0, endMs: 20_000 },
        { startMs: 20_000, endMs: 30_000 },
      ],
      removed: [1],
      tradedWithPrevious: false,
    });
    expect(resizeSceneSpan(song, 0, 24_000)).toEqual({
      spans: [
        { startMs: 0, endMs: 24_000 },
        { startMs: 24_000, endMs: 30_000 },
      ],
      removed: [1],
      tradedWithPrevious: false,
    });
    expect(resizeSceneSpan(song, 0, 19_400)).toEqual({
      error: 'That would leave the next section under 1 second. Lengthen this section enough to take the whole next section, or stop 1 second short of it.',
    });
    const consumed = resizeSceneSpan(song, 0, 20_000);
    if (!('spans' in consumed)) throw new Error('expected spans');
    expect(spansCover(30_000, consumed.spans)).toBe(true);
  });

  it('uses the song time in the plan and ignores a longer clip_duration', () => {
    const parsed = parseClipPlan({
      clips: [
        { clip_name: 'A', images_attached: ['a.png'], clip_duration: 10.5, vocal: 'yes', prompt: 'a', song_details: 'Song time: 0-8.2 seconds', image_details: '', context: false },
        { clip_name: 'B', images_attached: ['a.png'], clip_duration: 9.2, vocal: 'yes', prompt: 'b', song_details: 'Song time: 8.200–16.000s', image_details: '', context: true },
      ],
    });
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.plan.clips[1]?.context).toBe(true);
    const songMs = 16_000;
    const laid = songSpansForClips(songMs, parsed.plan.clips);
    if ('error' in laid) throw new Error(laid.error);
    expect(laid.fromSongTime).toBe(true);
    expect(laid.spans).toEqual([
      { startMs: 0, endMs: 8_200 },
      { startMs: 8_200, endMs: 16_000 },
    ]);
    expect(parsed.plan.clips.reduce((sum, clip) => sum + clip.durationSec, 0)).toBeCloseTo(19.7);
    const zayaSong = 149_232;
    const zaya = [
      { durationSec: 8.5, songStartMs: 0, songEndMs: 8_000 },
      { durationSec: 8.5, songStartMs: 8_000, songEndMs: 149_232 },
    ];
    const zayaLaid = songSpansForClips(zayaSong, zaya);
    if ('error' in zayaLaid) throw new Error(zayaLaid.error);
    expect(zayaLaid.spans[0]).toEqual({ startMs: 0, endMs: 8_000 });
    expect(zayaLaid.spans[1]?.endMs).toBe(149_232);
    expect(zaya.reduce((sum, clip) => sum + clip.durationSec, 0)).toBe(17);
    expect(songSpansForClips(149_232, [{ durationSec: 164.068, songStartMs: 0, songEndMs: 164_068 }])).toEqual({
      error: 'The song ranges end at 164.068s and the uploaded song is 149.232s. They must match within 0.5 seconds. clip_duration is the render length, not the song time.',
    });
    const audio = h3RequestSeconds(8_200, 10_500);
    expect(audio.audioSec).toBeCloseTo(8.2);
    expect(audio.renderSec).toBeCloseTo(10.5);
    expect(h3RequestSeconds(16_100, null).note).toMatch(/15 seconds/);
  });

  it('maps a dance video from song anchors and does not walk the trim forward on a second resize', () => {
    const track: MotionTrackPlan = {
      id: 'chorus_01',
      sourceId: 'dance_master_01',
      songStartMs: 0,
      songEndMs: 30_000,
      anchors: [
        { songMs: 0, videoMs: 12_000 },
        { songMs: 30_000, videoMs: 42_000 },
      ],
    };
    const first = motionVideoRange(track, 0, 10_000, 50_000);
    expect(first).toEqual({ videoStartMs: 12_000, videoEndMs: 22_000, status: 'ready' });
    const grown = motionVideoRange(track, 0, 12_000, 50_000);
    expect(grown).toEqual({ videoStartMs: 12_000, videoEndMs: 24_000, status: 'ready' });
    expect(motionVideoRange(track, 0, 12_000, 50_000)).toEqual(grown);
    expect(motionVideoRange(track, 20_000, 32_000, 50_000).status).toBe('outside');
    expect(motionVideoRange(track, 0, 1_000, 50_000).status).toBe('short');
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
