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

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return text.slice(0, 300) || `HTTP ${res.status}`;
}

/**
 * Instagram Reel via the resumable upload (graph.instagram.com). Bytes are pushed by us; Meta is not given a URL.
 * A failure after the bytes were sent is marked sent, so the caller records UNCERTAIN and does not retry.
 */
export async function uploadInstagramReel(
  fetchImpl: FetchFn,
  input: { version: string; igUserId: string; accessToken: string; caption: string; file: UploadBytes },
): Promise<UploadResult> {
  const base = `https://graph.instagram.com/${input.version}`;
  const start = await fetchImpl(`${base}/${encodeURIComponent(input.igUserId)}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: input.caption,
      access_token: input.accessToken,
    }),
  });
  if (!start.ok) {
    const detail = await readError(start);
    throw new UploadOutcome(`Instagram refused the upload: ${detail}`, false, start.status);
  }
  const started = (await start.json()) as { id?: string; uri?: string };
  if (!started.id) throw new UploadOutcome('Instagram did not return an upload id.', false);
  const uri = started.uri ?? `https://rupload.facebook.com/ig-api-upload/${input.version}/${started.id}`;
  let sent = false;
  try {
    const put = await fetchImpl(uri, {
      method: 'POST',
      headers: {
        authorization: `OAuth ${input.accessToken}`,
        offset: '0',
        file_size: String(input.file.size),
        'content-type': input.file.mime || 'application/octet-stream',
      },
      body: input.file.body as BodyInit,
    });
    sent = true;
    if (!put.ok) throw new UploadOutcome(`Instagram upload failed: ${await readError(put)}`, true, put.status);
    const deadline = Date.now() + 60_000;
    let status = 'IN_PROGRESS';
    while (Date.now() < deadline) {
      const poll = await fetchImpl(
        `${base}/${encodeURIComponent(started.id)}?fields=status_code&access_token=${encodeURIComponent(input.accessToken)}`,
      );
      const body = (await poll.json().catch(() => ({}))) as { status_code?: string };
      status = body.status_code ?? 'IN_PROGRESS';
      if (status === 'FINISHED' || status === 'ERROR' || status === 'EXPIRED') break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (status !== 'FINISHED')
      throw new UploadOutcome(`Instagram did not finish processing the video (${status}). Check the app before trying again.`, true);
    const pub = await fetchImpl(`${base}/${encodeURIComponent(input.igUserId)}/media_publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creation_id: started.id, access_token: input.accessToken }),
    });
    if (!pub.ok) throw new UploadOutcome(`Instagram did not publish the reel: ${await readError(pub)}`, true, pub.status);
    const done = (await pub.json()) as { id?: string };
    if (!done.id) throw new UploadOutcome('Instagram published the container but returned no post id.', true);
    return { externalId: done.id, url: `https://www.instagram.com/reel/${done.id}/` };
  } catch (e) {
    if (sent && !(e instanceof UploadOutcome))
      throw new UploadOutcome(`Instagram upload outcome is unknown: ${(e as Error).message}`, true);
    throw e;
  }
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
  const start = await fetchImpl(
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
    const put = await fetchImpl(location, {
      method: 'PUT',
      headers: { 'content-type': input.file.mime || 'video/mp4', 'content-length': String(input.file.size) },
      body: input.file.body as BodyInit,
    });
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
  const url = `https://graph.facebook.com/${input.version}/${encodeURIComponent(input.pageId)}/videos`;
  const start = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      upload_phase: 'start',
      file_size: input.file.size,
      access_token: input.accessToken,
    }),
  });
  if (!start.ok) {
    const detail = await readError(start);
    throw new UploadOutcome(`Facebook refused the upload: ${detail}`, false, start.status);
  }
  const session = (await start.json()) as { upload_session_id?: string; video_id?: string; start_offset?: string };
  if (!session.upload_session_id || !session.video_id)
    throw new UploadOutcome('Facebook did not return an upload session.', false);
  const bytes =
    input.file.body instanceof Uint8Array
      ? input.file.body
      : new Uint8Array(await new Response(input.file.body).arrayBuffer());
  const form = new FormData();
  form.set('upload_phase', 'transfer');
  form.set('upload_session_id', session.upload_session_id);
  form.set('start_offset', session.start_offset ?? '0');
  form.set('access_token', input.accessToken);
  const chunk = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: input.file.mime || 'video/mp4',
  });
  form.set('video_file_chunk', chunk, input.file.name || 'video.mp4');
  let sent = false;
  try {
    const transfer = await fetchImpl(url, { method: 'POST', body: form });
    sent = true;
    if (!transfer.ok)
      throw new UploadOutcome(`Facebook upload failed: ${await readError(transfer)}`, true, transfer.status);
    const finish = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'finish',
        upload_session_id: session.upload_session_id,
        title: input.title,
        description: input.description,
        access_token: input.accessToken,
      }),
    });
    if (!finish.ok)
      throw new UploadOutcome(`Facebook did not finish the video: ${await readError(finish)}`, true, finish.status);
    return { externalId: session.video_id, url: `https://www.facebook.com/watch/?v=${session.video_id}` };
  } catch (e) {
    if (sent && !(e instanceof UploadOutcome))
      throw new UploadOutcome(`Facebook upload outcome is unknown: ${(e as Error).message}`, true);
    throw e;
  }
}
