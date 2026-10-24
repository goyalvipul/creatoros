import { describe, expect, it } from 'vitest';
import {
  UploadOutcome,
  uploadFacebookVideo,
  uploadInstagramReel,
  uploadYoutubeVideo,
  youtubeUploadText,
} from './publish-upload';

describe('uploadFacebookVideo', () => {
  it('declares the real byte length and sends only the chunk Facebook asked for', async () => {
    const bytes = new Uint8Array(10).map((_, i) => i + 1);
    const calls: { url: string; phase: string; fileSize?: number; offset?: string; chunk?: number }[] = [];
    let transfers = 0;
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      if (typeof init.body === 'string') {
        const body = new URLSearchParams(init.body);
        const phase = body.get('upload_phase') ?? '';
        calls.push({ url, phase, fileSize: body.has('file_size') ? Number(body.get('file_size')) : undefined });
        if (phase === 'start') {
          return new Response(JSON.stringify({ upload_session_id: 'sess', video_id: 'vid', start_offset: '0', end_offset: '4' }));
        }
        return new Response(JSON.stringify({ success: true }));
      }
      const form = init.body as FormData;
      const chunk = form.get('video_file_chunk') as Blob;
      transfers += 1;
      calls.push({
        url,
        phase: String(form.get('upload_phase')),
        offset: String(form.get('start_offset')),
        chunk: chunk.size,
      });
      const start = Number(form.get('start_offset'));
      const next = start + chunk.size;
      const end = next >= bytes.byteLength ? bytes.byteLength : next + 4;
      return new Response(JSON.stringify({ start_offset: String(next), end_offset: String(Math.min(end, bytes.byteLength)) }));
    };
    const result = await uploadFacebookVideo(fetchImpl, {
      version: 'v23.0',
      pageId: 'page',
      accessToken: 'token',
      title: 'Mehak',
      description: 'caption',
      file: { body: bytes, size: 4, mime: 'video/mp4', name: 'clip.mp4' },
    });
    expect(result.externalId).toBe('vid');
    expect(calls[0]).toMatchObject({
      url: 'https://graph-video.facebook.com/v23.0/page/videos',
      phase: 'start',
      fileSize: 10,
    });
    expect(calls.filter((c) => c.phase === 'transfer').map((c) => [c.offset, c.chunk])).toEqual([
      ['0', 4],
      ['4', 4],
      ['8', 2],
    ]);
    expect(transfers).toBe(3);
    expect(calls.at(-1)?.phase).toBe('finish');
  });

  it('keeps a refused chunk retryable', async () => {
    const fetchImpl = async (_url: string, init: RequestInit = {}) => {
      if (typeof init.body === 'string') {
        return new Response(JSON.stringify({ upload_session_id: 'sess', video_id: 'vid', start_offset: '0', end_offset: '4' }));
      }
      return new Response(
        JSON.stringify({ error: { code: 6000, error_subcode: 1363045, message: 'There was a problem uploading your video file.' } }),
        { status: 400 },
      );
    };
    await expect(
      uploadFacebookVideo(fetchImpl, {
        version: 'v23.0',
        pageId: 'page',
        accessToken: 'token',
        title: 'Mehak',
        description: '',
        file: { body: new Uint8Array([1, 2, 3, 4]), size: 99, mime: 'video/mp4', name: 'clip.mp4' },
      }),
    ).rejects.toMatchObject({ sent: false });
    await expect(
      uploadFacebookVideo(fetchImpl, {
        version: 'v23.0',
        pageId: 'page',
        accessToken: 'token',
        title: 'Mehak',
        description: '',
        file: { body: new Uint8Array([1, 2, 3, 4]), size: 99, mime: 'video/mp4', name: 'clip.mp4' },
      }),
    ).rejects.toBeInstanceOf(UploadOutcome);
  });
});

describe('youtubeUploadText', () => {
  it('keeps tags out of the description and marks a Short on the title', () => {
    const video = youtubeUploadText({
      title: 'Come dance with me',
      description: 'A new song',
      tags: ['#mehakviking', 'trending'],
      form: 'VIDEO',
    });
    expect(video.description).toBe('A new song');
    expect(video.tags).toEqual(['mehakviking', 'trending']);
    expect(video.title).toBe('Come dance with me');
    const short = youtubeUploadText({
      title: 'Come dance with me',
      description: '',
      tags: ['gym'],
      form: 'SHORT',
    });
    expect(short.title).toBe('Come dance with me #Shorts');
    expect(short.description).toBe('');
  });
});

describe('uploadYoutubeVideo', () => {
  it('sets duplex when the file is a stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    });
    let put: RequestInit | undefined;
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      if (url.includes('uploadType=resumable')) {
        return new Response(null, { status: 200, headers: { location: 'https://upload.example/put' } });
      }
      put = init;
      return new Response(JSON.stringify({ id: 'yt1' }));
    };
    const result = await uploadYoutubeVideo(fetchImpl, {
      accessToken: 'token',
      title: 'Mehak',
      description: '',
      tags: [],
      privacy: 'unlisted',
      file: { body: stream, size: 4, mime: 'video/mp4', name: 'clip.mp4' },
    });
    expect(result.externalId).toBe('yt1');
    expect((put as { duplex?: string }).duplex).toBe('half');
  });
});

describe('uploadInstagramReel', () => {
  it('gives Instagram a public video_url and publishes after it finishes downloading', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/media?')) {
        return new Response(JSON.stringify({ id: 'container' }));
      }
      if (String(url).includes('status_code')) return new Response(JSON.stringify({ status_code: 'FINISHED' }));
      if (String(url).includes('permalink'))
        return new Response(JSON.stringify({ permalink: 'https://www.instagram.com/reel/AbC123/' }));
      return new Response(JSON.stringify({ id: 'post1' }));
    };
    const result = await uploadInstagramReel(fetchImpl, {
      version: 'v23.0',
      igUserId: 'ig',
      accessToken: 'token',
      caption: 'hello',
      videoUrl: 'https://os.example/api/v1/files/file/stream?token=abc',
    });
    const start = new URL(calls[0]!).searchParams;
    expect(start.get('media_type')).toBe('REELS');
    expect(start.get('video_url')).toBe('https://os.example/api/v1/files/file/stream?token=abc');
    expect(start.has('upload_type')).toBe(false);
    expect(new URL(calls.find((u) => u.includes('media_publish'))!).searchParams.get('creation_id')).toBe('container');
    expect(result.externalId).toBe('post1');
    expect(result.url).toBe('https://www.instagram.com/reel/AbC123/');
  });
});
