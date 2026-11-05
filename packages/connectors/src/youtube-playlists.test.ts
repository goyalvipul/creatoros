import { describe, expect, it } from 'vitest';
import { addYoutubeVideoToPlaylists, createYoutubePlaylist, listYoutubePlaylists } from './youtube-playlists';
import { uploadYoutubeVideo } from './publish-upload';

describe('youtube playlists', () => {
  it('reads the channel playlists and follows one page', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(String(url));
      if (!String(url).includes('pageToken')) {
        return new Response(
          JSON.stringify({
            nextPageToken: 'next',
            items: [{ id: 'PLabc', snippet: { title: 'Singles' }, status: { privacyStatus: 'unlisted' }, contentDetails: { itemCount: 2 } }],
          }),
        );
      }
      return new Response(JSON.stringify({ items: [{ id: 'PLdef', snippet: { title: 'Tour' } }] }));
    };
    const rows = await listYoutubePlaylists(fetchImpl, 'token');
    expect(rows.map((row) => row.title)).toEqual(['Singles', 'Tour']);
    expect(rows[0]).toMatchObject({ id: 'PLabc', privacy: 'UNLISTED', itemCount: 2 });
    expect(calls[1]).toContain('pageToken=next');
  });

  it('creates a playlist with the privacy that was chosen', async () => {
    let body = '';
    const fetchImpl = async (_url: string, init: RequestInit = {}) => {
      body = String(init.body);
      return new Response(JSON.stringify({ id: 'PLnew', snippet: { title: 'Mehak live' } }));
    };
    const created = await createYoutubePlaylist(fetchImpl, 'token', { title: 'Mehak live', privacy: 'unlisted' });
    expect(created.id).toBe('PLnew');
    expect(JSON.parse(body)).toEqual({
      snippet: { title: 'Mehak live' },
      status: { privacyStatus: 'unlisted' },
    });
  });

  it('skips a video that is already on the playlist', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'Video already in playlist.' } }), { status: 400 });
    const missed = await addYoutubeVideoToPlaylists(fetchImpl, 'token', 'vid', ['PLabc']);
    expect(missed).toEqual([]);
  });
});

describe('uploadYoutubeVideo synthetic disclosure', () => {
  it('sends containsSyntheticMedia only when AI use was chosen', async () => {
    const bodies: string[] = [];
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      if (String(url).includes('uploadType=resumable')) {
        bodies.push(String(init.body));
        return new Response(null, { status: 200, headers: { location: 'https://upload.example/put' } });
      }
      return new Response(JSON.stringify({ id: 'yt1' }));
    };
    await uploadYoutubeVideo(fetchImpl, {
      accessToken: 'token',
      title: 'Mehak',
      description: '',
      tags: [],
      privacy: 'unlisted',
      containsSyntheticMedia: true,
      file: { body: new Uint8Array([1, 2, 3, 4]), size: 4, mime: 'video/mp4', name: 'clip.mp4' },
    });
    expect(JSON.parse(bodies[0]!).status.containsSyntheticMedia).toBe(true);
    bodies.length = 0;
    await uploadYoutubeVideo(fetchImpl, {
      accessToken: 'token',
      title: 'Mehak',
      description: '',
      tags: [],
      privacy: 'unlisted',
      file: { body: new Uint8Array([1]), size: 1, mime: 'video/mp4', name: 'clip.mp4' },
    });
    expect(JSON.parse(bodies[0]!).status.containsSyntheticMedia).toBeUndefined();
  });
});
