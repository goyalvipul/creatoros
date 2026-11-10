import { describe, expect, it } from 'vitest';
import { aiCredentialPresence } from './ai';

describe('ai credentials', () => {
  it('reports presence without returning the key', () => {
    const state = aiCredentialPresence({ OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: '  ' });
    expect(state).toEqual({ openai: true, gemini: false });
    expect(JSON.stringify(state)).not.toContain('sk-test');
  });
});