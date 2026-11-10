import { describe, expect, it } from 'vitest';
import { CHATGPT_PLAN, clampYouTubeTitle, joinTags, limitAllows, parseMetadataDraft, parseScenePrompt, redactSecrets, taskProvider } from './ai';

describe('ai routing and guards', () => {
  it('requires OpenAI approval before a ChatGPT plan can write prompts', () => {
    expect(CHATGPT_PLAN.state).toBe('APPROVAL_REQUIRED');
    expect(CHATGPT_PLAN.interestForm).toContain('openai.com/form/sign-in-with-chatgpt-interest');
  });

  it('sends scene prompts to OpenAI and images to Gemini', () => {
    expect(taskProvider('scene_prompt_generate')).toBe('openai');
    expect(taskProvider('scene_image_generate')).toBe('gemini');
    expect(taskProvider('video_analyze')).toBe('gemini');
  });

  it('stops at the configured count', () => {
    expect(limitAllows(3, 4)).toBe(true);
    expect(limitAllows(4, 4)).toBe(false);
  });

  it('keeps a YouTube title inside 100 characters and drops tags that would overflow', () => {
    expect(clampYouTubeTitle('a'.repeat(140))).toHaveLength(100);
    expect(joinTags(['alpha', 'beta'], 6)).toEqual(['alpha']);
  });

  it('rejects a prompt that is missing the video field', () => {
    expect(() => parseScenePrompt({ imagePrompt: 'a frame' })).toThrow(/usable prompt/);
  });

  it('accepts a metadata draft and strips a long title', () => {
    const draft = parseMetadataDraft({
      titles: ['One'],
      recommendedTitle: 't'.repeat(130),
      description: 'A song',
      tags: ['mehak'],
      hashtags: ['#mehak'],
      caption: 'Listen',
      hook: 'Open',
      cta: 'Watch',
      thumbnailText: 'Mehak',
      thumbnailConcept: 'Close portrait',
      chapters: [],
      pinnedComment: '',
      onScreenText: '',
      warnings: [],
    });
    expect(draft.recommendedTitle).toHaveLength(100);
    expect(draft.tags).toEqual(['mehak']);
  });

  it('redacts keys that leak into an error string', () => {
    expect(redactSecrets('GET ?key=secret-value failed sk-abcdefghijklmnop')).not.toContain('secret-value');
    expect(redactSecrets('GET ?key=secret-value failed sk-abcdefghijklmnop')).not.toContain('sk-abcdefghijklmnop');
  });
});