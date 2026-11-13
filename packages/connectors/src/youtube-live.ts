/**
 * YouTube Live Streaming API. The stream name is returned to the caller and must be encrypted before it is stored.
 * Errors never include the bearer token.
 */
import { redactStreamSecrets } from '@creatoros/domain';

const API = 'https://www.googleapis.com/youtube/v3';

export interface LiveBroadcastDraft {
  title: string;
  description: string;
  privacyStatus: 'public' | 'unlisted' | 'private';
  madeForKids: boolean;
  scheduledStartTime?: string | null;
  enableDvr: boolean;
  enableEmbed: boolean;
  recordFromStart: boolean;
  enableAutoStart: boolean;
  enableAutoStop: boolean;
  latencyPreference: 'normal' | 'low' | 'ultraLow';
  resolution: '720p' | '1080p';
  closedCaptionsType?: 'closedCaptionsDisabled' | 'closedCaptionsEmbedded';
}

export interface VideoEdits {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
  privacyStatus?: 'public' | 'unlisted' | 'private';
  selfDeclaredMadeForKids?: boolean;
  containsSyntheticMedia?: boolean;
  license?: 'youtube' | 'creativeCommon';
}

type FetchFn = typeof fetch;

async function yt(fetchImpl: FetchFn, token: string, url: string, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetchImpl(url, { ...init, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason || json?.error?.message || text || res.statusText;
    throw new Error(redactStreamSecrets(`YouTube ${res.status} ${reason}`).slice(0, 400));
  }
  return json;
}

export async function createLiveBroadcast(fetchImpl: FetchFn, token: string, draft: LiveBroadcastDraft) {
  const body = {
    snippet: {
      title: draft.title,
      description: draft.description,
      scheduledStartTime: draft.scheduledStartTime ?? new Date().toISOString(),
    },
    status: { privacyStatus: draft.privacyStatus, selfDeclaredMadeForKids: draft.madeForKids },
    contentDetails: {
      enableDvr: draft.enableDvr,
      enableEmbed: draft.enableEmbed,
      recordFromStart: draft.recordFromStart,
      enableAutoStart: draft.enableAutoStart,
      enableAutoStop: draft.enableAutoStop,
      latencyPreference: draft.latencyPreference,
      closedCaptionsType: draft.closedCaptionsType ?? 'closedCaptionsDisabled',
      enableContentEncryption: true,
      startWithSlate: false,
      monitorStream: { enableMonitorStream: false },
    },
  };
  const json = await yt(
    fetchImpl,
    token,
    `${API}/liveBroadcasts?part=snippet,status,contentDetails`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  const id = String(json?.id ?? '');
  if (!id) throw new Error('YouTube did not return a broadcast id.');
  return { broadcastId: id, lifeCycleStatus: String(json?.status?.lifeCycleStatus ?? '') };
}

export async function createIngestionStream(
  fetchImpl: FetchFn,
  token: string,
  title: string,
  resolution: '720p' | '1080p',
) {
  const json = await yt(fetchImpl, token, `${API}/liveStreams?part=snippet,cdn,status`, {
    method: 'POST',
    body: JSON.stringify({
      snippet: { title },
      cdn: { frameRate: '30fps', ingestionType: 'rtmp', resolution },
      contentDetails: { isReusable: false },
    }),
  });
  const info = json?.cdn?.ingestionInfo ?? {};
  const streamId = String(json?.id ?? '');
  const ingestionAddress = String(info.ingestionAddress ?? '');
  const streamName = String(info.streamName ?? '');
  if (!streamId || !ingestionAddress || !streamName) throw new Error('YouTube did not return an ingestion stream.');
  return { streamId, ingestionAddress, streamName };
}

export async function bindLiveBroadcast(fetchImpl: FetchFn, token: string, broadcastId: string, streamId: string) {
  await yt(
    fetchImpl,
    token,
    `${API}/liveBroadcasts/bind?id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(streamId)}&part=id,contentDetails`,
    { method: 'POST' },
  );
}

export async function transitionLiveBroadcast(
  fetchImpl: FetchFn,
  token: string,
  broadcastId: string,
  status: 'testing' | 'live' | 'complete',
) {
  return yt(
    fetchImpl,
    token,
    `${API}/liveBroadcasts/transition?broadcastStatus=${status}&id=${encodeURIComponent(broadcastId)}&part=status,snippet`,
    { method: 'POST' },
  );
}

/** Upcoming broadcasts on this channel. The caller may reuse one only when the match is unambiguous. */
export async function listUpcomingBroadcasts(fetchImpl: FetchFn, token: string) {
  const json = await yt(
    fetchImpl,
    token,
    `${API}/liveBroadcasts?part=id,snippet,status,contentDetails&mine=true&broadcastStatus=upcoming&maxResults=50`,
  );
  const items = Array.isArray(json?.items) ? json.items : [];
  return items
    .map((item: { id?: string; snippet?: { title?: string }; status?: { lifeCycleStatus?: string }; contentDetails?: { boundStreamId?: string } }) => ({
      broadcastId: String(item.id ?? ''),
      title: String(item.snippet?.title ?? ''),
      lifeCycleStatus: String(item.status?.lifeCycleStatus ?? ''),
      boundStreamId: item.contentDetails?.boundStreamId ? String(item.contentDetails.boundStreamId) : null,
    }))
    .filter((item: { broadcastId: string }) => item.broadcastId);
}

export async function readLiveBroadcast(fetchImpl: FetchFn, token: string, broadcastId: string) {
  const json = await yt(
    fetchImpl,
    token,
    `${API}/liveBroadcasts?part=snippet,status,contentDetails&id=${encodeURIComponent(broadcastId)}`,
  );
  const item = json?.items?.[0];
  if (!item) return null;
  return {
    lifeCycleStatus: String(item.status?.lifeCycleStatus ?? ''),
    actualStartTime: item.snippet?.actualStartTime ? String(item.snippet.actualStartTime) : null,
    actualEndTime: item.snippet?.actualEndTime ? String(item.snippet.actualEndTime) : null,
    boundStreamId: item.contentDetails?.boundStreamId ? String(item.contentDetails.boundStreamId) : null,
  };
}

export async function readIngestion(fetchImpl: FetchFn, token: string, streamId: string) {
  const json = await yt(fetchImpl, token, `${API}/liveStreams?part=status&id=${encodeURIComponent(streamId)}`);
  return String(json?.items?.[0]?.status?.streamStatus ?? '');
}

function pick(source: Record<string, unknown> | undefined, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) out[key] = source[key];
  }
  return out;
}

/** Read the video, then write back the fields we did not mean to change. */
export async function updateLiveVideo(fetchImpl: FetchFn, token: string, videoId: string, edits: VideoEdits) {
  const current = await yt(fetchImpl, token, `${API}/videos?part=snippet,status&id=${encodeURIComponent(videoId)}`);
  const item = current?.items?.[0];
  if (!item) throw new Error('YouTube has no video for this broadcast yet.');
  const snippet = {
    ...pick(item.snippet, ['title', 'description', 'tags', 'categoryId', 'defaultLanguage', 'defaultAudioLanguage']),
    ...stripUndefined({
      title: edits.title,
      description: edits.description,
      tags: edits.tags,
      categoryId: edits.categoryId,
      defaultLanguage: edits.defaultLanguage,
    }),
  };
  const status = {
    ...pick(item.status, [
      'privacyStatus',
      'embeddable',
      'license',
      'publicStatsViewable',
      'selfDeclaredMadeForKids',
      'containsSyntheticMedia',
    ]),
    ...stripUndefined({
      privacyStatus: edits.privacyStatus,
      selfDeclaredMadeForKids: edits.selfDeclaredMadeForKids,
      containsSyntheticMedia: edits.containsSyntheticMedia,
      license: edits.license,
    }),
  };
  await yt(fetchImpl, token, `${API}/videos?part=snippet,status`, {
    method: 'PUT',
    body: JSON.stringify({ id: videoId, snippet, status }),
  });
  return { snippet, status };
}

export async function readLiveVideo(fetchImpl: FetchFn, token: string, videoId: string) {
  const json = await yt(
    fetchImpl,
    token,
    `${API}/videos?part=snippet,status,processingDetails&id=${encodeURIComponent(videoId)}`,
  );
  const item = json?.items?.[0];
  if (!item) return null;
  return {
    title: String(item.snippet?.title ?? ''),
    description: String(item.snippet?.description ?? ''),
    tags: Array.isArray(item.snippet?.tags) ? item.snippet.tags.map(String) : [],
    privacyStatus: String(item.status?.privacyStatus ?? ''),
    uploadStatus: String(item.status?.uploadStatus ?? ''),
    processingStatus: String(item.processingDetails?.processingStatus ?? ''),
    madeForKids: item.status?.selfDeclaredMadeForKids === true,
    containsSyntheticMedia: item.status?.containsSyntheticMedia,
  };
}

export async function setLiveThumbnail(fetchImpl: FetchFn, token: string, videoId: string, bytes: Uint8Array, mime: string) {
  const res = await fetchImpl(`${API}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': mime },
    body: Buffer.from(bytes),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(redactStreamSecrets(`YouTube thumbnail ${res.status} ${text}`).slice(0, 300));
  }
}

/** 18+ rating. YouTube only documents `ytAgeRestricted`; leaving it off means no age restriction was sent. */
export async function setLiveAgeRestriction(fetchImpl: FetchFn, token: string, videoId: string) {
  await yt(fetchImpl, token, `${API}/videos?part=contentDetails`, {
    method: 'PUT',
    body: JSON.stringify({ id: videoId, contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } } }),
  });
}

/** Paid promotion label. The owner chooses yes or no; an unset choice does not call this. */
export async function setLivePaidPromotion(fetchImpl: FetchFn, token: string, videoId: string, hasPaidProductPlacement: boolean) {
  await yt(fetchImpl, token, `${API}/videos?part=paidProductPlacementDetails`, {
    method: 'PUT',
    body: JSON.stringify({ id: videoId, paidProductPlacementDetails: { hasPaidProductPlacement } }),
  });
}

/** Mid-roll ads. A channel that cannot monetize gets an error from YouTube; the caller keeps the broadcast. */
export async function updateLiveMonetization(fetchImpl: FetchFn, token: string, broadcastId: string, ads: 'on' | 'off') {
  const monetizationDetails =
    ads === 'on'
      ? { adsMonetizationStatus: 'on', cuepointSchedule: { enabled: true, ytOptimizedCuepointConfig: 'MEDIUM' } }
      : { adsMonetizationStatus: 'off', cuepointSchedule: { enabled: false } };
  await yt(fetchImpl, token, `${API}/liveBroadcasts?part=monetizationDetails`, {
    method: 'PUT',
    body: JSON.stringify({ id: broadcastId, monetizationDetails }),
  });
}

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
