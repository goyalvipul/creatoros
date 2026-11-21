import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertComfyImageMatches, comfyInputName } from './comfy';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reference image staging across GPU workers', () => {
  it('gives different image bytes different names even when the original filename matches', () => {
    const imageA = Buffer.from('original Mehak reference image');
    const imageB = Buffer.from('other picture with identical uploaded filename');
    const nameA = comfyInputName(imageA, 'mehak.png');
    const nameB = comfyInputName(imageB, 'mehak.png');
    expect(nameA).toMatch(/^cos_up_[0-9a-f]{20}_mehak\.png$/);
    expect(nameA).not.toBe(nameB);
    expect(comfyInputName(imageA, 'mehak.png')).toBe(nameA);
    expect(comfyInputName(imageA, 'nested/portrait.png')).toMatch(/_portrait\.png$/);
  });

  it('verifies identical reference bytes on both GPUs and uses the input filename', async () => {
    const image = Buffer.from('the exact reference used for both models');
    const fetchMock = vi.fn(async (_url: URL) => new Response(Uint8Array.from(image), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const expectedHash = createHash('sha256').update(image).digest('hex');
    const first = await assertComfyImageMatches('http://100.85.189.23:8188', 'folder/portrait.png', image);
    const second = await assertComfyImageMatches('http://100.113.189.17:8188', 'portrait.png', image);
    expect(first).toBe(expectedHash);
    expect(second).toBe(expectedHash);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = fetchMock.mock.calls[0]?.[0] as URL;
    const secondUrl = fetchMock.mock.calls[1]?.[0] as URL;
    expect(firstUrl.pathname).toBe('/view');
    expect(firstUrl.searchParams.get('filename')).toBe('portrait.png');
    expect(firstUrl.searchParams.get('subfolder')).toBe('folder');
    expect(firstUrl.searchParams.get('type')).toBe('input');
    expect(secondUrl.searchParams.get('filename')).toBe('portrait.png');
    expect(secondUrl.hostname).toBe('100.113.189.17');
  });

  it('refuses to render when the target GPU has a different image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Uint8Array.from(Buffer.from('wrong image')), { status: 200 })));
    await expect(assertComfyImageMatches('http://127.0.0.1:8188', 'ref.png', Buffer.from('reference'))).rejects.toThrow(/different reference image/);
  });

  it('refuses to render when the GPU does not expose its staged image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));
    await expect(assertComfyImageMatches('http://127.0.0.1:8188', 'ref.png', Buffer.from('reference'))).rejects.toThrow(/could not read/);
  });

  it('refuses an unsafe returned image path', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(assertComfyImageMatches('http://127.0.0.1:8188', '../ref.png', Buffer.from('reference'))).rejects.toThrow(/invalid/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
