import { describe, expect, it } from 'vitest';
import { analyseEngagement } from './trends';
import { validateDefinition } from './workflow';

const love = (kind: 'DM' | 'COMMENT', platform = 'INSTAGRAM') => ({
  text: 'I love your voice so much',
  kind,
  platform,
  needsReply: kind === 'COMMENT',
  at: '2026-10-01T00:00:00.000Z',
});

describe('analyseEngagement', () => {
  it('turns a repeated compliment into an approval workflow and does not send', () => {
    const { trends } = analyseEngagement([
      love('COMMENT'),
      love('COMMENT'),
      love('DM', 'FACEBOOK'),
      { text: 'love your voice on the new one', kind: 'COMMENT', platform: 'INSTAGRAM', needsReply: true },
    ]);
    const hit = trends.find((t) => t.category === 'COMPLIMENT' && t.theme);
    expect(hit?.count).toBe(4);
    expect(hit?.commentCount).toBe(3);
    expect(hit?.dmCount).toBe(1);
    expect(hit?.needReply).toBe(3);
    expect(hit?.theme).toBe('love your voice');
    expect(hit?.messageIndexes).toEqual([0, 1, 2, 3]);
    expect(hit?.detail.some((line) => line.includes('Every message in this group contains'))).toBe(true);
    expect(hit?.workflow?.mode).toBe('APPROVAL');
    expect(hit?.workflow?.definition.trigger.event).toBe('COMMENT_RECEIVED');
    const steps = hit?.workflow?.definition.steps ?? [];
    expect(steps.some((s) => s.kind === 'action' && s.action.type === 'send_reply')).toBe(false);
    expect(validateDefinition(hit?.workflow?.definition, 'APPROVAL').ok).toBe(true);
  });

  it('keeps two different phrases as two groups', () => {
    const { trends } = analyseEngagement([
      { text: 'I love your voice', kind: 'COMMENT', platform: 'INSTAGRAM' },
      { text: 'love your voice always', kind: 'COMMENT', platform: 'INSTAGRAM' },
      { text: 'such a beautiful song tonight', kind: 'DM', platform: 'FACEBOOK' },
      { text: 'beautiful song tonight again', kind: 'DM', platform: 'FACEBOOK' },
    ]);
    const themes = trends.filter((t) => t.theme).map((t) => t.theme);
    expect(themes).toContain('love your voice');
    expect(themes).toContain('beautiful song tonight');
    const indexes = trends.filter((t) => t.theme).flatMap((t) => t.messageIndexes);
    expect(new Set(indexes).size).toBe(4);
  });

  it('does not offer a reply workflow for spam', () => {
    const { trends } = analyseEngagement([
      { text: 'check my page https://spam.example and follow me back', kind: 'DM', platform: 'INSTAGRAM' },
      { text: 'free followers click the link https://spam.example', kind: 'DM', platform: 'INSTAGRAM' },
      { text: 'crypto investment dm me https://spam.example', kind: 'COMMENT', platform: 'YOUTUBE' },
    ]);
    expect(trends[0]?.category).toBe('SPAM');
    expect(trends[0]?.workflow).toBeNull();
  });

  it('returns nothing when there is only one message', () => {
    expect(analyseEngagement([{ text: 'hello there friend', kind: 'DM', platform: 'INSTAGRAM' }]).trends).toEqual(
      [],
    );
  });
});