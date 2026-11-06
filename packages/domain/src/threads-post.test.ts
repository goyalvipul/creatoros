import { describe, expect, it } from 'vitest';
import { threadsPostError, threadsTextUnits } from './threads-post';

describe('threads post fields', () => {
  it('counts an emoji as several units and rejects a topic with a period', () => {
    expect(threadsTextUnits('a')).toBe(1);
    expect(threadsTextUnits('😀')).toBeGreaterThan(1);
    expect(threadsPostError({ text: 'hello', topic: 'song.one', reply: 'everyone', ai: 'NO' })).toMatch(/period/);
    expect(threadsPostError({ text: 'hello', topic: 'newsong', reply: 'everyone', ai: 'YES' })).toBe('');
    expect(threadsPostError({ text: 'hello', topic: '', reply: 'everyone', ai: '' })).toMatch(/AI label/);
  });
});
