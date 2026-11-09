import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from '@creatoros/db';
import { hmacHex, safeEqualHex } from './crypto';
import { badRequest, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const MAX_BYTES = 2_000_000;

function kindOf(bytes: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function mimeOf(ext: string) {
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

async function itemOf(ctx: Ctx, variantId: string, itemId: string) {
  const row = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      select id from publish_items
      where id = ${itemId} and variant_id = ${variantId} and org_id = ${ctx.orgId}`),
  )[0];
  if (!row) throw notFound('Attached file');
  return row;
}

export async function savePublishCover(
  ctx: Ctx,
  variantId: string,
  itemId: string,
  input: { data: string; source: 'frame' | 'upload'; atMs?: number | null },
) {
  await itemOf(ctx, variantId, itemId);
  const raw = input.data.includes(',') ? input.data.slice(input.data.indexOf(',') + 1) : input.data;
  const bytes = Buffer.from(raw, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) throw badRequest('The thumbnail has to be under 2 MB.');
  const kind = kindOf(bytes);
  if (!kind) throw badRequest('Use a JPEG, PNG, or WebP picture.');
  if (input.source === 'frame' && (input.atMs == null || input.atMs < 0)) throw badRequest('Pick a frame from the video.');
  const dir = join(ctx.env.mediaPreviewDir, 'publish-covers');
  await mkdir(dir, { recursive: true });
  for (const ext of ['jpg', 'png', 'webp']) await rm(join(dir, `${itemId}.${ext}`), { force: true });
  const rel = `publish-covers/${itemId}.${kind}`;
  await writeFile(join(ctx.env.mediaPreviewDir, rel), bytes);
  const at = input.source === 'frame' ? Math.round(input.atMs ?? 0) : null;
  await ctx.db.execute(sql`
    update publish_items
    set cover_path = ${rel}, cover_offset_ms = ${at}, cover_source = ${input.source}
    where id = ${itemId} and org_id = ${ctx.orgId}`);
  return { hasCover: true, source: input.source, atMs: at };
}

export async function clearPublishCover(ctx: Ctx, variantId: string, itemId: string) {
  await itemOf(ctx, variantId, itemId);
  const dir = join(ctx.env.mediaPreviewDir, 'publish-covers');
  for (const ext of ['jpg', 'png', 'webp']) await rm(join(dir, `${itemId}.${ext}`), { force: true });
  await ctx.db.execute(sql`
    update publish_items
    set cover_path = null, cover_offset_ms = null, cover_source = null
    where id = ${itemId} and org_id = ${ctx.orgId}`);
  return { hasCover: false };
}

export async function readPublishCover(ctx: Pick<Ctx, 'db' | 'env'>, itemId: string, orgId?: string) {
  const row = rowsOf<{ coverPath: string | null; orgId: string }>(
    await ctx.db.execute(sql`
      select cover_path as "coverPath", org_id as "orgId" from publish_items where id = ${itemId}`),
  )[0];
  if (!row?.coverPath) return null;
  if (orgId && row.orgId !== orgId) return null;
  if (!row.coverPath.startsWith(`publish-covers/${itemId}.`)) return null;
  const ext = row.coverPath.split('.').pop() || 'jpg';
  try {
    const bytes = await readFile(join(ctx.env.mediaPreviewDir, row.coverPath));
    return { mime: mimeOf(ext), bytes };
  } catch {
    return null;
  }
}

export function signCoverToken(secret: string, itemId: string, exp: number) {
  const payload = `cover.${itemId}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${hmacHex(secret, payload)}`;
}

export function verifyCoverToken(secret: string, token: string, now = Date.now()): { itemId: string } | null {
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const payload = Buffer.from(p, 'base64url').toString('utf8');
  if (!safeEqualHex(hmacHex(secret, payload), sig)) return null;
  const [kind, itemId, exp] = payload.split('.');
  if (kind !== 'cover' || !itemId || Number(exp) < now) return null;
  return { itemId };
}
