import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildH3Prompt } from './h3';

const graph = JSON.parse(
  readFileSync(new URL('../../../docs/comfy/MINIMAX H3 Motion Context FINAL API.json', import.meta.url), 'utf8'),
) as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;

describe('MiniMax H3 graph', () => {
  it('writes a fresh shot and drops the unused song trim', () => {
    const prompt = buildH3Prompt(graph, {
      projectName: 'cosabc123',
      seed: 7,
      segments: [
        {
          continuity: 'shot',
          taskMode: 'ref',
          prompt: 'Look at <Picture 1>.',
          images: [{ name: 'mehak.png', shared: true }],
          audioName: 'a.wav',
          durationSec: 8.88,
        },
        {
          continuity: 'context',
          taskMode: 'ref',
          prompt: 'Keep talking.',
          images: [{ name: 'mehak.png', shared: true }],
          audioName: 'b.wav',
          durationSec: 8,
        },
      ],
      aspectRatio: '9:16 (Portrait Widescreen)',
      megapixels: 1,
      audioLocked: true,
    });
    expect(prompt['37']).toBeUndefined();
    expect(prompt['38']).toBeUndefined();
    expect(prompt['11']?.inputs?.unet_name).toBe('Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors');
    expect(prompt['25']?.inputs?.['input_mode.video']).toEqual(['17', 0]);
    expect(prompt['15']?.inputs?.project_name).toBe('cosabc123');
    expect(prompt['15']?.inputs?.seed).toBe(7);
    const saved = JSON.parse(String(prompt['17']?.inputs?.project_data));
    expect(saved.project_name).toBe('cosabc123');
    expect(saved.clips).toEqual([]);
    expect(JSON.stringify(saved)).not.toContain('longtake_demo');
    const track = JSON.parse(String(prompt['29']?.inputs?.track_data)) as {
      total_length: number;
      tracks: { type: string; segments: { start_frame: number; end_frame: number; content: Record<string, unknown> }[] }[];
    };
    expect(track.total_length).toBe(Math.round(8.88 * 24) + Math.round(8 * 24));
    const task = track.tracks.find((t) => t.type === 'task')!;
    expect(task.segments[0]?.content.continuity_mode).toBe('shot');
    expect(task.segments[1]?.content.continuity_mode).toBe('context');
    expect(task.segments[0]?.content.user_prompt).toBe('Look at <Picture 1>.');
    expect(prompt['29']?.inputs?.['resolution.aspect_ratio']).toBe('9:16 (Portrait Widescreen)');
    expect(prompt['29']?.inputs?.['resolution.megapixels']).toBe(1);
    expect(task.segments[1]?.content.user_prompt).toBe('Keep talking.');
    expect(task.segments[0]?.content.ref_image_size).toBe('max');
    expect(task.segments[0]?.content.task_mode).toBe('ref');
    expect((task.segments[1]?.content.images as { shared_reference_copy?: boolean }[])[0]?.shared_reference_copy).toBe(true);
    expect((task.segments[0]?.content.images as { file_name: string }[])[0]?.file_name).toBe('mehak.png');
    const audio = track.tracks.find((t) => t.type === 'audio')! as { audio_locked?: boolean; segments: { content: Record<string, unknown> }[] };
    expect(audio.audio_locked).toBe(true);
    expect(audio.segments.map((s) => s.content.file_name)).toEqual(['a.wav', 'b.wav']);
    expect(graph['37']).toBeDefined();
  });

  it('leaves the audio track empty and unlocked when no file is attached', () => {
    const prompt = buildH3Prompt(graph, {
      projectName: 'cosnone',
      seed: 1,
      segments: [
        {
          continuity: 'shot',
          taskMode: 'ref',
          refImageSize: 'match',
          prompt: 'She talks.',
          images: [{ name: 'mehak.png', shared: false }],
          audioName: null,
          durationSec: 8,
        },
      ],
      aspectRatio: '9:16 (Portrait Widescreen)',
      megapixels: 1,
      audioLocked: true,
    });
    const track = JSON.parse(String(prompt['29']?.inputs?.track_data)) as {
      tracks: { type: string; audio_locked?: boolean; segments: unknown[] }[];
    };
    const audio = track.tracks.find((t) => t.type === 'audio')!;
    expect(audio.segments).toEqual([]);
    expect(audio.audio_locked).toBe(false);
    const task = track.tracks.find((t) => t.type === 'task')! as { segments: { content: { ref_image_size?: string } }[] };
    expect(task.segments[0]?.content.ref_image_size).toBe('match');
  });
});
