import type { ConnectorContext } from './types';

/** `sent` is true only after the video bytes were handed to the platform. Those must not be retried automatically. */
export class UploadOutcome extends Error {
  constructor(
    message: string,
    readonly sent: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UploadOutcome';
  }
}

export interface UploadBytes {
  body: Uint8Array | ReadableStream<Uint8Array>;
  size: number;
  mime: string;
  name: string;
}

export interface UploadResult {
  externalId: string;
  url: string | null;
}

type FetchFn = ConnectorContext['fetch'];
type NodeInit = RequestInit & { duplex?: 'half' };

/** Node refuses a streamed body unless duplex is set. A buffered file does not need it. */
function withFile(file: UploadBytes, init: NodeInit): NodeInit {
  if (file.body instanceof Uint8Array) return { ...init, body: new Uint8Array(file.body) };
  return { ...init, body: file.body as NodeInit['body'], duplex: 'half' };
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/** A platform that never answers must fail the draft. Five minutes is enough for one request, not a silent spin. */
function bounded(fetchImpl: FetchFn): FetchFn {
  return (url, init) => fetchImpl(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(5 * 60_000) });
}

async function readUploadBytes(file: UploadBytes): Promise<Uint8Array> {
  if (file.body instanceof Uint8Array) return file.body;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new UploadOutcome('Reading the video from the computer took too long. Press Try again.', false)),
      5 * 60_000,
    );
  });
  try {
    return new Uint8Array(await Promise.race([new Response(file.body).arrayBuffer(), timeout]));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The id Instagram and Facebook return is not the public link. `permalink` is. */
async function mediaPermalink(call: FetchFn, url: string): Promise<string | null> {
  try {
    const res = await call(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { permalink?: string; permalink_url?: string };
    const link = body.permalink || body.permalink_url || '';
    if (link.startsWith('https://')) return link;
    if (link.startsWith('/')) return `https://www.facebook.com${link}`;
    return null;
  } catch {
    return null;
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return text.slice(0, 300) || `HTTP ${res.status}`;
}

/**
 * Instagram Reel for an Instagram Login token. That API does not accept the file bytes.
 * It downloads `video_url` itself, so the URL must be a public https address Instagram can fetch.
 * The container is not a published post until media_publish succeeds.
 */
export async function uploadInstagramReel(
  fetchImpl: FetchFn,
  input: {
    version: string;
    igUserId: string;
    accessToken: string;
    caption: string;
    videoUrl: string;
    /** A frame from the video, in milliseconds. */
    thumbOffsetMs?: number | null;
    /** A JPEG Instagram can download. Used when the owner uploaded a picture. */
    coverUrl?: string | null;
    /** Shown to non-followers first. The owner graduates it in the Instagram app. */
    trial?: boolean;
    /** Instagram is_ai_generated. Sent only when the owner answered Yes. */
    aiGenerated?: boolean;
  },
): Promise<UploadResult> {
  const call = bounded(fetchImpl);
  const base = `https://graph.instagram.com/${input.version}`;
  if (!input.videoUrl.startsWith('https://'))
    throw new UploadOutcome('Instagram can only download the video from a public https address.', false);
  const startQuery = new URLSearchParams({
    media_type: 'REELS',
    video_url: input.videoUrl,
    caption: input.caption,
    access_token: input.accessToken,
  });
  if (input.coverUrl) startQuery.set('cover_url', input.coverUrl);
  else if (input.thumbOffsetMs != null) startQuery.set('thumb_offset', String(Math.max(0, Math.round(input.thumbOffsetMs))));
  if (input.trial) startQuery.set('trial_params', JSON.stringify({ graduation_strategy: 'MANUAL' }));
  if (input.aiGenerated) startQuery.set('is_ai_generated', 'true');
  const start = await call(`${base}/${encodeURIComponent(input.igUserId)}/media?${startQuery}`, {
    method: 'POST',
  });
  if (!start.ok) {
    const detail = await readError(start);
    throw new UploadOutcome(`Instagram refused the upload: ${detail}`, false, start.status);
  }
  const started = (await start.json()) as { id?: string };
  if (!started.id) throw new UploadOutcome('Instagram did not return an upload id.', false);
  const deadline = Date.now() + 5 * 60_000;
  let status = 'IN_PROGRESS';
  let detail = '';
  while (Date.now() < deadline) {
    const poll = await call(
      `${base}/${encodeURIComponent(started.id)}?fields=status_code,status&access_token=${encodeURIComponent(input.accessToken)}`,
    );
    const body = (await poll.json().catch(() => ({}))) as { status_code?: string; status?: string };
    status = body.status_code ?? 'IN_PROGRESS';
    detail = body.status ?? '';
    if (status === 'FINISHED' || status === 'ERROR' || status === 'EXPIRED') break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (status !== 'FINISHED')
    throw new UploadOutcome(
      `Instagram did not finish the video (${status}${detail ? `: ${detail}` : ''}). The PC that holds the file must stay on while Instagram downloads it.`,
      false,
    );
  const pubQuery = new URLSearchParams({ creation_id: started.id, access_token: input.accessToken });
  const pub = await call(`${base}/${encodeURIComponent(input.igUserId)}/media_publish?${pubQuery}`, {
    method: 'POST',
  });
  if (!pub.ok) throw new UploadOutcome(`Instagram did not publish the reel: ${await readError(pub)}`, true, pub.status);
  const done = (await pub.json()) as { id?: string };
  if (!done.id) throw new UploadOutcome('Instagram published the container but returned no post id.', true);
  const permalink = await mediaPermalink(
    call,
    `${base}/${encodeURIComponent(done.id)}?fields=permalink&access_token=${encodeURIComponent(input.accessToken)}`,
  );
  return { externalId: done.id, url: permalink };
}

/**
 * YouTube description stays the description. Tags are snippet.tags, never copied into the description.
 * A Short is not a separate upload call. YouTube lists it as a Short when the file is vertical or square and
 * at most 3 minutes. #Shorts on the title is the only extra signal the API accepts.
 */
export function youtubeUploadText(input: {
  title: string;
  description: string;
  tags: string[];
  form: 'VIDEO' | 'SHORT';
}): { title: string; description: string; tags: string[] } {
  let title = input.title.trim() || 'Untitled';
  if (input.form === 'SHORT' && !/#shorts\b/i.test(title)) {
    const marked = `${title} #Shorts`;
    title = marked.length <= 100 ? marked : `${title.slice(0, 92).trimEnd()} #Shorts`;
  }
  title = title.slice(0, 100);
  const tags: string[] = [];
  let used = 0;
  for (const raw of input.tags) {
    const tag = raw.replace(/^#/, '').replace(/[<>]/g, '').trim();
    if (!tag) continue;
    const next = used + tag.length + (tags.length ? 1 : 0);
    if (next > 500) break;
    tags.push(tag);
    used = next;
  }
  return { title, description: input.description, tags };
}

/** YouTube resumable videos.insert. Requires the youtube.upload scope. */
export async function uploadYoutubeVideo(
  fetchImpl: FetchFn,
  input: {
    accessToken: string;
    title: string;
    description: string;
    tags: string[];
    privacy: 'public' | 'unlisted' | 'private';
    /** YouTube status.containsSyntheticMedia. Omitted when the owner has not chosen. */
    containsSyntheticMedia?: boolean;
    file: UploadBytes;
  },
): Promise<UploadResult> {
  const call = bounded(fetchImpl);
  const start = await call(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(input.file.size),
        'x-upload-content-type': input.file.mime || 'video/mp4',
      },
      body: JSON.stringify({
        snippet: { title: input.title, description: input.description, tags: input.tags },
        status: {
          privacyStatus: input.privacy,
          ...(typeof input.containsSyntheticMedia === 'boolean'
            ? { containsSyntheticMedia: input.containsSyntheticMedia }
            : {}),
        },
      }),
    },
  );
  if (!start.ok) {
    const detail = await readError(start);
    throw new UploadOutcome(`YouTube refused the upload: ${detail}`, false, start.status);
  }
  const location = start.headers.get('location');
  if (!location) throw new UploadOutcome('YouTube did not return an upload URL.', false);
  let sent = false;
  try {
    const put = await call(
      location,
      withFile(input.file, {
        method: 'PUT',
        headers: { 'content-type': input.file.mime || 'video/mp4', 'content-length': String(input.file.size) },
      }),
    );
    sent = true;
    if (!put.ok) throw new UploadOutcome(`YouTube upload failed: ${await readError(put)}`, true, put.status);
    const video = (await put.json()) as { id?: string };
    if (!video.id) throw new UploadOutcome('YouTube did not return a video id.', true);
    return { externalId: video.id, url: `https://www.youtube.com/watch?v=${video.id}` };
  } catch (e) {
    if (sent && !(e instanceof UploadOutcome))
      throw new UploadOutcome(`YouTube upload outcome is unknown: ${(e as Error).message}`, true);
    throw e;
  }
}

/** YouTube custom thumbnail. The channel must be allowed to set one. A refusal does not remove the video. */
export async function setYoutubeThumbnail(
  fetchImpl: FetchFn,
  input: { accessToken: string; videoId: string; bytes: Uint8Array; mime: string },
): Promise<void> {
  const call = bounded(fetchImpl);
  const res = await call(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(input.videoId)}&uploadType=media`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'content-type': input.mime || 'image/jpeg',
        'content-length': String(input.bytes.byteLength),
      },
      body: input.bytes as unknown as BodyInit,
    },
  );
  if (!res.ok) throw new Error(await readError(res));
}

/** Facebook Page preferred thumbnail. A refusal does not remove the video. */
export async function setFacebookThumbnail(
  fetchImpl: FetchFn,
  input: { version: string; videoId: string; accessToken: string; bytes: Uint8Array; mime: string },
): Promise<void> {
  const call = bounded(fetchImpl);
  const body = new FormData();
  body.set('access_token', input.accessToken);
  body.set('is_preferred', 'true');
  body.set('source', new Blob([input.bytes as unknown as BlobPart], { type: input.mime || 'image/jpeg' }), 'cover.jpg');
  const res = await call(`https://graph.facebook.com/${input.version}/${encodeURIComponent(input.videoId)}/thumbnails`, {
    method: 'POST',
    body,
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Facebook Page video, resumable start/transfer/finish. Needs pages_manage_posts on the Page token. */
export async function uploadFacebookVideo(
  fetchImpl: FetchFn,
  input: {
    version: string;
    pageId: string;
    accessToken: string;
    title: string;
    description: string;
    file: UploadBytes;
  },
): Promise<UploadResult> {
  const call = bounded(fetchImpl);
  // Declare the bytes we actually send. The scanned size can be smaller than the file on disk, and Facebook
  // rejects that mismatch with error 6000 / 1363045 ("problem uploading your video file").
  const bytes = await readUploadBytes(input.file);
  const url = `https://graph-video.facebook.com/${input.version}/${encodeURIComponent(input.pageId)}/videos`;
  const start = await call(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      upload_phase: 'start',
      file_size: String(bytes.byteLength),
      access_token: input.accessToken,
    }),
  });
  if (!start.ok) {
    const detail = await readError(start);
    throw new UploadOutcome(`Facebook refused the upload: ${detail}`, false, start.status);
  }
  const session = (await start.json()) as {
    upload_session_id?: string;
    video_id?: string;
    start_offset?: string;
    end_offset?: string;
  };
  if (!session.upload_session_id || !session.video_id)
    throw new UploadOutcome('Facebook did not return an upload session.', false);
  let offset = Number(session.start_offset ?? 0);
  let end = Number(session.end_offset ?? bytes.byteLength);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  let sent = false;
  try {
    let guard = 0;
    while (offset < bytes.byteLength) {
      if (guard++ > 10_000) throw new UploadOutcome('Facebook upload did not advance.', sent);
      const chunkEnd = Math.min(bytes.byteLength, Number.isFinite(end) && end > offset ? end : bytes.byteLength);
      const form = new FormData();
      form.set('upload_phase', 'transfer');
      form.set('upload_session_id', session.upload_session_id);
      form.set('start_offset', String(offset));
      form.set('access_token', input.accessToken);
      const slice = bytes.subarray(offset, chunkEnd);
      const copy = new Uint8Array(slice.byteLength);
      copy.set(slice);
      form.set(
        'video_file_chunk',
        new Blob([copy], { type: input.file.mime || 'video/mp4' }),
        input.file.name || 'video.mp4',
      );
      const transfer = await call(url, { method: 'POST', body: form });
      if (!transfer.ok)
        throw new UploadOutcome(`Facebook upload failed: ${await readError(transfer)}`, sent, transfer.status);
      sent = true;
      const progress = (await transfer.json()) as { start_offset?: string; end_offset?: string };
      const next = Number(progress.start_offset ?? chunkEnd);
      if (!Number.isFinite(next) || next <= offset)
        throw new UploadOutcome('Facebook did not accept the next part of the video.', true);
      offset = next;
      end = Number(progress.end_offset ?? bytes.byteLength);
    }
    const finish = await call(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        upload_phase: 'finish',
        upload_session_id: session.upload_session_id,
        title: input.title,
        description: input.description,
        access_token: input.accessToken,
      }),
    });
    if (!finish.ok)
      throw new UploadOutcome(`Facebook did not finish the video: ${await readError(finish)}`, true, finish.status);
    const permalink = await mediaPermalink(
      call,
      `https://graph.facebook.com/${input.version}/${encodeURIComponent(session.video_id)}?fields=permalink_url&access_token=${encodeURIComponent(input.accessToken)}`,
    );
    return {
      externalId: session.video_id,
      url: permalink ?? `https://www.facebook.com/watch/?v=${session.video_id}`,
    };
  } catch (e) {
    if (sent && !(e instanceof UploadOutcome))
      throw new UploadOutcome(`Facebook upload outcome is unknown: ${(e as Error).message}`, true);
    throw e;
  }
}

/**
 * Threads image or video. Threads downloads the file from a public https URL.
 * The container is not a post until threads_publish succeeds.
 */
export async function uploadThreadsPost(
  fetchImpl: FetchFn,
  input: {
    userId: string;
    accessToken: string;
    mediaType: 'IMAGE' | 'VIDEO';
    mediaUrl: string;
    text: string;
    topicTag?: string | null;
    replyControl: string;
    madeWithAi: boolean;
  },
): Promise<UploadResult> {
  const call = bounded(fetchImpl);
  const base = 'https://graph.threads.net/v1.0';
  if (!input.mediaUrl.startsWith('https://'))
    throw new UploadOutcome('Threads can only download the file from a public https address.', false);
  const fields: Record<string, string> = {
    media_type: input.mediaType,
    access_token: input.accessToken,
    reply_control: input.replyControl,
    [input.mediaType === 'VIDEO' ? 'video_url' : 'image_url']: input.mediaUrl,
  };
  if (input.text) fields.text = input.text;
  if (input.topicTag) fields.topic_tag = input.topicTag;
  if (input.madeWithAi) fields.is_made_with_ai = 'true';
  const start = await call(`${base}/${encodeURIComponent(input.userId)}/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form(fields),
  });
  if (!start.ok) throw new UploadOutcome(`Threads refused the post: ${scrub(await readError(start))}`, false, start.status);
  const started = (await start.json()) as { id?: string };
  if (!started.id) throw new UploadOutcome('Threads did not return an upload id.', false);
  const deadline = Date.now() + 5 * 60_000;
  let status = 'IN_PROGRESS';
  let detail = '';
  while (Date.now() < deadline) {
    const poll = await call(
      `${base}/${encodeURIComponent(started.id)}?fields=status,error_message&access_token=${encodeURIComponent(input.accessToken)}`,
    );
    const body = (await poll.json().catch(() => ({}))) as { status?: string; error_message?: string };
    status = body.status ?? 'IN_PROGRESS';
    detail = body.error_message ?? '';
    if (status === 'FINISHED' || status === 'ERROR' || status === 'EXPIRED' || status === 'PUBLISHED') break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (status !== 'FINISHED' && status !== 'PUBLISHED')
    throw new UploadOutcome(
      `Threads did not finish the file (${status}${detail ? `: ${detail}` : ''}). The PC that holds the file must stay on while Threads downloads it. A video can be at most 5 minutes.`,
      false,
    );
  if (status === 'PUBLISHED') return { externalId: started.id, url: null };
  const pub = await call(`${base}/${encodeURIComponent(input.userId)}/threads_publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ creation_id: started.id, access_token: input.accessToken }),
  });
  if (!pub.ok) throw new UploadOutcome(`Threads did not publish the post: ${scrub(await readError(pub))}`, true, pub.status);
  const done = (await pub.json()) as { id?: string };
  if (!done.id) throw new UploadOutcome('Threads published the container but returned no post id.', true);
  const permalink = await mediaPermalink(
    call,
    `${base}/${encodeURIComponent(done.id)}?fields=permalink&access_token=${encodeURIComponent(input.accessToken)}`,
  );
  return { externalId: done.id, url: permalink };
}

function scrub(message: string) {
  return message.replace(/access_token=[^&\s]+/gi, 'access_token=redacted');
}

const TIKTOK_MIN_CHUNK = 5_000_000;
const TIKTOK_MAX_CHUNK = 64_000_000;

/** TikTok wants one chunk when the file is at most 64 MB. Larger files use 10 MB chunks, and the last chunk can be bigger. */
export function tiktokChunkPlan(videoSize: number): { chunkSize: number; totalChunkCount: number } {
  if (videoSize < 1) throw new UploadOutcome('The video is empty.', false);
  if (videoSize <= TIKTOK_MAX_CHUNK) return { chunkSize: videoSize, totalChunkCount: 1 };
  let chunkSize = 10_000_000;
  let count = Math.floor(videoSize / chunkSize);
  while (count > 1000 && chunkSize < TIKTOK_MAX_CHUNK) {
    chunkSize = Math.min(TIKTOK_MAX_CHUNK, chunkSize * 2);
    count = Math.floor(videoSize / chunkSize);
  }
  if (count < 1 || count > 1000 || chunkSize < TIKTOK_MIN_CHUNK)
    throw new UploadOutcome('This video is too large for one TikTok upload.', false);
  return { chunkSize, totalChunkCount: count };
}

export interface TikTokCreatorInfo {
  username: string | null;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoSeconds: number | null;
}

function tiktokRefusal(code: string | undefined, message: string, status: number, privacy?: string): string {
  if (code === 'unaudited_client_can_only_post_to_private_accounts' || /integration guidelines/i.test(message)) {
    return privacy === 'SELF_ONLY'
      ? 'TikTok has not reviewed this app yet. In the TikTok app, set this account to Private, keep Who can watch on Only me, and publish again.'
      : 'TikTok has not reviewed this app yet. Set Who can watch to Only me, and in the TikTok app set this account to Private, then publish again.';
  }
  return `TikTok refused the post: ${message || `HTTP ${status}`}`;
}

async function tiktokJson<T>(res: Response, sent: boolean, privacy?: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
  const code = body.error?.code;
  if (!res.ok || (code && code !== 'ok'))
    throw new UploadOutcome(tiktokRefusal(code, body.error?.message ?? '', res.status, privacy), sent);
  return (body.data ?? {}) as T;
}

export async function queryTikTokCreator(fetchImpl: FetchFn, accessToken: string): Promise<TikTokCreatorInfo> {
  const call = bounded(fetchImpl);
  const res = await call('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
    body: '{}',
  });
  const data = await tiktokJson<{
    creator_username?: string;
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  }>(res, false);
  return {
    username: data.creator_username ?? null,
    privacyOptions: data.privacy_level_options ?? [],
    commentDisabled: Boolean(data.comment_disabled),
    duetDisabled: Boolean(data.duet_disabled),
    stitchDisabled: Boolean(data.stitch_disabled),
    maxVideoSeconds: data.max_video_post_duration_sec ?? null,
  };
}

/**
 * Direct Post. The file bytes are uploaded to TikTok. The post is not public until status is PUBLISH_COMPLETE.
 * An unaudited app can only use the privacy levels TikTok returns for this creator, often Only me.
 */
export async function uploadTikTokVideo(
  fetchImpl: FetchFn,
  input: {
    accessToken: string;
    file: UploadBytes;
    title: string;
    privacyLevel: string;
    disableComment: boolean;
    disableDuet: boolean;
    disableStitch: boolean;
    username?: string | null;
    /** Frame time in milliseconds. TikTok does not accept a separate picture. */
    coverTimestampMs?: number | null;
    /** TikTok post_info.is_aigc. Omitted until the owner answers. */
    isAigc?: boolean;
  },
): Promise<UploadResult> {
  const call = bounded(fetchImpl);
  const bytes = await readUploadBytes(input.file);
  const plan = tiktokChunkPlan(bytes.byteLength);
  const init = await call('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: input.title,
        privacy_level: input.privacyLevel,
        disable_comment: input.disableComment,
        disable_duet: input.disableDuet,
        disable_stitch: input.disableStitch,
        brand_content_toggle: false,
        brand_organic_toggle: false,
        ...(typeof input.isAigc === 'boolean' ? { is_aigc: input.isAigc } : {}),
        ...(input.coverTimestampMs != null ? { video_cover_timestamp_ms: Math.max(0, Math.round(input.coverTimestampMs)) } : {}),
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: bytes.byteLength,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount,
      },
    }),
  });
  const started = await tiktokJson<{ publish_id?: string; upload_url?: string }>(init, false, input.privacyLevel);
  if (!started.publish_id || !started.upload_url) throw new UploadOutcome('TikTok did not return an upload.', false);
  let sent = false;
  try {
    for (let i = 0; i < plan.totalChunkCount; i++) {
      const start = i * plan.chunkSize;
      const endExclusive = i === plan.totalChunkCount - 1 ? bytes.byteLength : start + plan.chunkSize;
      const slice = bytes.subarray(start, endExclusive);
      const copy = new Uint8Array(slice.byteLength);
      copy.set(slice);
      const put = await call(started.upload_url, {
        method: 'PUT',
        headers: {
          'content-type': input.file.mime || 'video/mp4',
          'content-length': String(copy.byteLength),
          'content-range': `bytes ${start}-${endExclusive - 1}/${bytes.byteLength}`,
        },
        body: copy,
      });
      sent = true;
      if (!put.ok && put.status !== 201 && put.status !== 206)
        throw new UploadOutcome(`TikTok did not accept the video (${put.status}).`, true, put.status);
    }
    const deadline = Date.now() + 5 * 60_000;
    let status = 'PROCESSING_UPLOAD';
    let postId = '';
    let failReason = '';
    while (Date.now() < deadline) {
      const poll = await call('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
        method: 'POST',
        headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ publish_id: started.publish_id }),
      });
      const data = await tiktokJson<{ status?: string; publicaly_available_post_id?: string[]; fail_reason?: string }>(poll, true);
      status = data.status ?? status;
      postId = data.publicaly_available_post_id?.[0] ?? postId;
      failReason = data.fail_reason ?? '';
      if (status === 'PUBLISH_COMPLETE' || status === 'FAILED' || status === 'SEND_TO_USER_INBOX') break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (status === 'SEND_TO_USER_INBOX')
      throw new UploadOutcome('TikTok put the video in your inbox instead of posting it. Finish it in the TikTok app, or post as Only me if the app is not audited.', true);
    if (status !== 'PUBLISH_COMPLETE')
      throw new UploadOutcome(`TikTok did not publish the video (${status}${failReason ? `: ${failReason}` : ''}).`, true);
    const url = postId
      ? input.username
        ? `https://www.tiktok.com/@${input.username}/video/${postId}`
        : `https://www.tiktok.com/video/${postId}`
      : null;
    return { externalId: postId || started.publish_id, url };
  } catch (e) {
    if (sent && !(e instanceof UploadOutcome))
      throw new UploadOutcome(`TikTok upload outcome is unknown: ${(e as Error).message}`, true);
    throw e;
  }
}
