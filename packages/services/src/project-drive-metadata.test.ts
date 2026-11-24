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
  it('defaults YouTube Shorts metadata to 9:16 and accepts platform aspect hints', () => {
    expect(raw.contentForm).toBe('SHORT');
    expect(raw.thumbnail.aspect).toBe('9:16');
    expect(metadataTemplate(projectId, { ...expected, platform: 'instagram' }).thumbnail.aspect).toBe('9:16');
    expect(metadataTemplate(projectId, { ...expected, platform: 'facebook' }).thumbnail.aspect).toBe('1.91:1');
    expect(parseSocialMetadata({ ...raw, thumbnail: { ...raw.thumbnail, aspect: '9:16' } }, expected).thumbnail?.aspect).toBe('9:16');
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
  it('accepts a research-ready thumbnail brief without changing project or social IDs', () => {
    const meta = parseSocialMetadata({
      ...raw, ready: true, title: 'Eh Oh Ra live performance',
      thumbnail: { ...raw.thumbnail, headline: 'THE VOCAL MOMENT', placement: 'top-left',
        fontStyle: 'impact', hookType: 'performance',
        notes: 'Use the expressive close-up, place short text away from the eyes.' },
    }, expected);
    expect(meta.thumbnail?.placement).toBe('top-left');
    expect(meta.thumbnail?.fontStyle).toBe('impact');
    expect(meta.thumbnail?.notes).toContain('eyes');
  });
  it('blocks production-process references in visible titles and thumbnail copy', () => {
    expect(() => parseSocialMetadata({ ...raw, ready: true, title: 'AI-generated Mehak video' }, expected))
      .toThrow(/production-process/);
    expect(() => parseSocialMetadata({
      ...raw, ready: true, title: 'Eh Oh Ra', thumbnail: { ...raw.thumbnail, headline: 'AI Model Sings' },
    }, expected)).toThrow(/production-process/);
    expect(parseSocialMetadata({ ...raw, ready: true, title: 'Eh Oh Ra', aiUse: 'YES' }, expected).aiUse).toBe('YES');
  });
  it('accepts an account-bound embedded JPG and rejects a mismatched thumbnail filename', () => {
    const imageFile = `thumb__${itemId}__${accountId}.jpg`;
    const tinyJpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    const meta = parseSocialMetadata({
      ...raw, ready: true, title: 'Eh Oh Ra',
      thumbnail: { ...raw.thumbnail, imageFile, imageBase64: tinyJpg },
    }, expected);
    expect(meta.thumbnail?.imageFile).toBe(imageFile);
    expect(() => parseSocialMetadata({
      ...raw, ready: true, title: 'Eh Oh Ra',
      thumbnail: { ...raw.thumbnail, imageFile: `thumb__${accountId}__${itemId}.jpg`, imageBase64: tinyJpg },
    }, expected)).toThrow(/matching video\/account/);
    expect(() => parseSocialMetadata({
      ...raw, ready: true, title: 'Eh Oh Ra',
      thumbnail: { ...raw.thumbnail, imageFile, imageBase64: 'not-base64!' },
    }, expected)).toThrow(/base64/);
  });
  it('rejects oversized fields and invented API fields', () => {
    expect(() => parseSocialMetadata({ ...raw, caption: 'x'.repeat(5001) }, expected)).toThrow();
    expect(() => parseSocialMetadata({ ...raw, autoPublish: true }, expected)).toThrow();
    expect(() => parseSocialMetadata({ ...raw, ready: true, title: '' }, expected)).toThrow(/YouTube|title or caption/);
  });
});
