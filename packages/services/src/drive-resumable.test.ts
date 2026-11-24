import { describe, expect, it, vi } from 'vitest';
import { uploadDriveStream } from './drive-resumable';

function streamOf(bytes: Uint8Array, segment = 3) {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= bytes.length) return c.close();
      c.enqueue(bytes.slice(at, at + segment));
      at += segment;
    },
  });
}

describe('Drive resumable media uploads', () => {
  it('uploads a locked-once source without reusing its stream as a request body', async () => {
    const content = new TextEncoder().encode('abcdefghijklmnopqrstuvwxyz');
    const calls: Array<{ range: string; bytes: number[] }> = [];
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      const body = options?.body as Uint8Array;
      calls.push({ range: new Headers(options?.headers).get('content-range') || '', bytes: [...body] });
      return new Response(JSON.stringify({ id: 'new-drive-file', size: String(content.length) }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await uploadDriveStream('https://www.googleapis.com/upload/session', 'token', streamOf(content), content.length, 'video/mp4', fetcher);
    expect(result.id).toBe('new-drive-file');
    expect(calls).toEqual([{ range: 'bytes 0-25/26', bytes: [...content] }]);
  });

  it('retries a transient HTTP failure using new bytes, not a previously consumed body', async () => {
    const original = new TextEncoder().encode('abc123');
    const bodies: Uint8Array[] = [];
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      bodies.push(Uint8Array.from(options?.body as Uint8Array));
      return bodies.length === 1
        ? new Response('busy', { status: 503 })
        : new Response(JSON.stringify({ id: 'done', size: '6' }), { status: 200 });
    }) as unknown as typeof fetch;
    await uploadDriveStream('https://www.googleapis.com/upload/session', 'token', streamOf(original), 6, 'video/mp4', fetcher);
    expect(bodies).toHaveLength(2);
    expect([...bodies[0]!]).toEqual([...bodies[1]!]);
    expect(bodies[0]).not.toBe(bodies[1]);
  });

  it('refuses a truncated response stream instead of marking completion', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(uploadDriveStream('https://www.googleapis.com/upload/session', 'token', streamOf(new Uint8Array([1,2,3])), 10, 'video/mp4', fetcher))
      .rejects.toThrow(/ended early/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an untrusted resumable session and mismatched confirmed file size', async () => {
    const bytes = new Uint8Array([1,2,3]);
    await expect(uploadDriveStream('https://evil.invalid/upload', 'token', streamOf(bytes), 3, 'video/mp4')).rejects.toThrow(/Untrusted/);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'ok', size: '2' }), { status: 200 })) as unknown as typeof fetch;
    await expect(uploadDriveStream('https://www.googleapis.com/upload/session', 'token', streamOf(bytes), 3, 'video/mp4', fetcher)).rejects.toThrow(/different uploaded file size/);
  });
});
