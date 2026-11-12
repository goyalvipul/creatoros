import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { comfyInputCopyRel, keepComfyInputCopy, readComfyInputCopy } from './comfy';

const org = '11111111-1111-4111-8111-111111111111';
const worker = '22222222-2222-4222-8222-222222222222';

describe('comfy input copies', () => {
  it('keeps a copy under the PC that first received the upload', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cos-input-'));
    expect(comfyInputCopyRel(org, worker, 'folder/cos_up_photo.png')).toBe(`comfy-inputs/${org}/${worker}/cos_up_photo.png`);
    expect(comfyInputCopyRel('not-an-id', worker, 'photo.png')).toBeNull();
    expect(comfyInputCopyRel(org, worker, '../secret.png')).toBe(`comfy-inputs/${org}/${worker}/secret.png`);
    await keepComfyInputCopy(dir, org, worker, 'cos_up_photo.png', Buffer.from('picture'));
    const copy = await readComfyInputCopy(dir, org, worker, 'sub/cos_up_photo.png');
    expect(copy?.toString()).toBe('picture');
    const onDisk = await readFile(path.join(dir, 'comfy-inputs', org, worker, 'cos_up_photo.png'));
    expect(onDisk.toString()).toBe('picture');
  });
});
