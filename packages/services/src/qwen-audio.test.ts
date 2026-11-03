import { describe, expect, it } from 'vitest';
import { sliceAudioRange, toPlayableAudio } from './qwen';

function floatWav(): Buffer {
  const pcm = Buffer.alloc(8);
  pcm.writeFloatLE(0.5, 0);
  pcm.writeFloatLE(-0.5, 4);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(24000 * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

describe('phone playback', () => {
  it('turns a float WAV into 16-bit PCM', () => {
    const out = toPlayableAudio('voice.wav', floatWav());
    expect(out.type).toBe('audio/wav');
    expect(out.body.readUInt16LE(20)).toBe(1);
    expect(out.body.readUInt16LE(34)).toBe(16);
    expect(out.body.readInt16LE(44)).toBeGreaterThan(0);
  });

  it('answers a phone range request with 206', () => {
    const body = Buffer.from('abcdefghijklmnopqrstuvwxyz');
    const sliced = sliceAudioRange(body, 'bytes=0-1');
    expect(sliced.status).toBe(206);
    expect(sliced.body.toString()).toBe('ab');
    expect(sliced.contentRange).toBe('bytes 0-1/26');
  });
});
