/** A download must not be served as a video. Phones play video/mp4 inside the installed app and never save the file. */
export function attachmentHeaders(name: string): Record<string, string> {
  const encoded = encodeURIComponent(name);
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_').slice(0, 180) || 'download';
  return {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  };
}
