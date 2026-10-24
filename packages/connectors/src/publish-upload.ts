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
  input: { version: string; igUserId: string; accessToken: string; caption: string; videoUrl: string },
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
        status: { privacyStatus: input.privacy },
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
