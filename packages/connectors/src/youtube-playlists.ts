import type { ConnectorContext } from './types';

type FetchFn = ConnectorContext['fetch'];

export interface YtPlaylist {
  id: string;
  title: string;
  privacy: string;
  itemCount: number;
}

const API = 'https://www.googleapis.com/youtube/v3';

async function youtubeMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = parsed.error?.errors?.[0]?.reason ?? '';
    if (res.status === 403 && /insufficient|forbidden|accessNotConfigured/i.test(reason)) {
      return 'YouTube has not granted permission to change playlists. Integrations → Enable comments, then try again.';
    }
    return (parsed.error?.message || text).slice(0, 300);
  } catch {
    return text.slice(0, 300) || `YouTube returned HTTP ${res.status}`;
  }
}

/** Lists the channel's own playlists. youtube.readonly is enough. */
export async function listYoutubePlaylists(fetchImpl: FetchFn, accessToken: string): Promise<YtPlaylist[]> {
  const out: YtPlaylist[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({
      part: 'snippet,status,contentDetails',
      mine: 'true',
      maxResults: '50',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await fetchImpl(`${API}/playlists?${q}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(await youtubeMessage(res));
    const body = (await res.json()) as {
      nextPageToken?: string;
      items?: {
        id?: string;
        snippet?: { title?: string };
        status?: { privacyStatus?: string };
        contentDetails?: { itemCount?: number };
      }[];
    };
    for (const item of body.items ?? []) {
      if (!item.id) continue;
      out.push({
        id: item.id,
        title: item.snippet?.title?.trim() || item.id,
        privacy: (item.status?.privacyStatus ?? '').toUpperCase(),
        itemCount: item.contentDetails?.itemCount ?? 0,
      });
    }
    pageToken = body.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return out;
}

/** Creates a playlist on the channel. Needs youtube.force-ssl (Enable comments). */
export async function createYoutubePlaylist(
  fetchImpl: FetchFn,
  accessToken: string,
  input: { title: string; privacy: 'public' | 'unlisted' | 'private' },
): Promise<YtPlaylist> {
  const res = await fetchImpl(`${API}/playlists?part=snippet,status`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      snippet: { title: input.title },
      status: { privacyStatus: input.privacy },
    }),
  });
  if (!res.ok) throw new Error(await youtubeMessage(res));
  const item = (await res.json()) as { id?: string; snippet?: { title?: string } };
  if (!item.id) throw new Error('YouTube did not return the new playlist.');
  return { id: item.id, title: item.snippet?.title?.trim() || input.title, privacy: input.privacy.toUpperCase(), itemCount: 0 };
}

/**
 * Adds one uploaded video to each playlist. A video already in the playlist is left there.
 * Returns the playlist ids that were not added.
 */
export async function addYoutubeVideoToPlaylists(
  fetchImpl: FetchFn,
  accessToken: string,
  videoId: string,
  playlistIds: string[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const playlistId of playlistIds) {
    const res = await fetchImpl(`${API}/playlistItems?part=snippet`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
      }),
    });
    if (res.ok) continue;
    const message = await youtubeMessage(res);
    if (/already/i.test(message)) continue;
    failed.push(`${playlistId}: ${message}`);
  }
  return failed;
}
