import { describe, expect, it } from 'vitest';
import { metadataTemplate, metadataFileName, parseSocialMetadata } from './project-drive-metadata';

const projectId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const fileInstanceId = '33333333-3333-4333-8333-333333333333';
const accountId = '44444444-4444-4444-8444-444444444444';
const expected = { projectId, itemId, fileInstanceId, fileName: 'clip.mp4', accountId, platform: 'youtube' };
const raw = metadataTemplate(projectId, expected);

describe('project social metadata contract', () => {
  it('generates stable per-video per-account names', () => {
    expect(metadataFileName(itemId, accountId)).toBe(`meta__${itemId}__${accountId}.json`);
  });
  it('begins as an inactive placeholder and uses private YouTube defaults', () => {
    expect(raw.ready).toBe(false);
    expect(raw.privacy).toBe('PRIVATE');
    expect(raw.aiUse).toBe('YES');
    expect(parseSocialMetadata(raw, expected).ready).toBe(false);
  });
  it('accepts analyzed metadata for the correct video/account', () => {
    const meta = parseSocialMetadata({ ...raw, ready: true, title: 'Mehak Sings', caption: 'New studio session', hashtags: ['Mehak'] }, expected);
    expect(meta.title).toBe('Mehak Sings');
  });
  it('rejects a substituted video, platform or account', () => {
    expect(() => parseSocialMetadata({ ...raw, ready: true, title: 'X', fileInstanceId: itemId }, expected)).toThrow(/identity/);
    expect(() => parseSocialMetadata({ ...raw, ready: true, title: 'X', platform: 'tiktok' }, expected)).toThrow(/identity/);
    expect(() => parseSocialMetadata({ ...raw, ready: true, title: 'X', socialAccountId: fileInstanceId }, expected)).toThrow(/identity/);
  });
  it('rejects oversized fields and invented API fields', () => {
    expect(() => parseSocialMetadata({ ...raw, caption: 'x'.repeat(5001) }, expected)).toThrow();
    expect(() => parseSocialMetadata({ ...raw, autoPublish: true }, expected)).toThrow();
    expect(() => parseSocialMetadata({ ...raw, ready: true, title: '' }, expected)).toThrow(/YouTube|title or caption/);
  });
});
