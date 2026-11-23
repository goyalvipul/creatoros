/** Google Drive resumable media uploader.
 * Never passes the scanner-agent Response.body directly to undici's fetch:
 * every request owns a new in-memory Uint8Array slice (8 MiB max).
 * This avoids "Response body object should not be disturbed or locked",
 * supports transient retries and rejects incomplete uploads.
 */
const CHUNK_SIZE = 8 * 1024 * 1024;
export type DriveUploadResult = { id: string; name?: string; size?: string; appProperties?: Record<string, string> };

function nextOffset(range: string | null, start: number, end: number) {
  if (!range) return start; // No bytes acknowledged; retry this same slice.
  const match = /^bytes=0-(\d+)$/.exec(range);
  if (!match) throw new Error('Google Drive returned an invalid resumable Range.');
  const offset = Number(match[1]) + 1;
  if (!Number.isSafeInteger(offset) || offset < start || offset > end + 1)
    throw new Error('Google Drive acknowledged an unexpected byte range.');
  return offset;
}

function transient(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export async function uploadDriveStream(
  url: string,
  accessToken: string,
  stream: ReadableStream<Uint8Array>,
  expectedSize: number,
  mime: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DriveUploadResult> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0)
    throw new Error('The source file has an invalid length.');
  const session = new URL(url);
  if (session.protocol !== 'https:' || (session.hostname !== 'www.googleapis.com' && session.hostname !== 'content.googleapis.com'))
    throw new Error('Untrusted Google Drive upload session URL.');

  const reader = stream.getReader();
  let pending = new Uint8Array(0);
  let pendingPosition = 0;
  let eof = false;
  let offset = 0;
  try {
    while (offset < expectedSize) {
      const target = Math.min(CHUNK_SIZE, expectedSize - offset);
      const chunk = new Uint8Array(target);
      let written = 0;
      while (written < target) {
        if (pendingPosition >= pending.length) {
          const next = await reader.read();
          if (next.done) { eof = true; break; }
          pending = next.value;
          pendingPosition = 0;
          continue;
        }
        const bytes = Math.min(target - written, pending.length - pendingPosition);
        chunk.set(pending.subarray(pendingPosition, pendingPosition + bytes), written);
        written += bytes;
        pendingPosition += bytes;
      }
      if (written !== target) throw new Error(`The source ended early: read ${offset + written} of ${expectedSize} bytes.`);

      const end = offset + chunk.length - 1;
      let cursor = offset;
      let errors = 0;
      while (cursor <= end) {
        let response: Response | null = null;
        try {
          // A fresh byte view for EACH HTTP request. Never replay a consumed ReadableStream.
          const bytes = Uint8Array.from(chunk.subarray(cursor - offset));
          response = await fetchImpl(session.href, {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': mime,
              'content-range': `bytes ${cursor}-${end}/${expectedSize}`,
            },
            body: bytes,
            signal: AbortSignal.timeout(180_000),
          });
        } catch (err) {
          if (++errors > 4) throw new Error(`Drive transfer failed at byte ${cursor}: ${String(err)}`);
          continue;
        }
        if (response.status === 308) {
          const newer = nextOffset(response.headers.get('range'), cursor, end);
          if (newer === cursor && ++errors > 4) throw new Error(`Google Drive did not accept bytes after ${cursor}.`);
          if (newer > cursor) errors = 0;
          cursor = newer;
          continue;
        }
        if (response.ok) {
          if (end + 1 !== expectedSize) throw new Error('Google Drive ended the upload before the final chunk.');
          const result = await response.json() as DriveUploadResult;
          if (!result.id) throw new Error('Drive did not confirm the uploaded file ID.');
          if (result.size && Number(result.size) !== expectedSize) throw new Error('Google Drive reported a different uploaded file size.');
          const extra = await reader.read();
          if (!extra.done || pendingPosition !== pending.length)
            throw new Error('The source contains more bytes than its declared file size.');
          return result;
        }
        if (transient(response.status) && ++errors <= 4) continue;
        throw new Error(`Google Drive rejected bytes ${cursor}-${end} (HTTP ${response.status}): ${(await response.text().catch(() => '')).slice(0,250)}`);
      }
      offset = end + 1;
    }
    throw new Error('Drive upload did not return final confirmation.');
  } finally {
    if (!eof) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
