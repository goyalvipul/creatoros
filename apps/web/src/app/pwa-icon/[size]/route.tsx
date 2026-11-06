import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-static';

/** Older installed apps still request this path. It now serves the real icon. */
export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const file = size === '192' ? 'kemokem-pwa-192.png' : 'kemokem-pwa-512.png';
  const buf = await readFile(path.join(process.cwd(), 'public/brand', file));
  return new Response(buf, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
  });
}

export function generateStaticParams() {
  return [{ size: '192' }, { size: '512' }, { size: '1024' }];
}
