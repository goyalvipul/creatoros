import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { sql, type Db } from '@creatoros/db';
import { hmacHex, safeEqualHex } from './crypto';
import { badRequest, notFound, type Ctx, type ServiceEnv } from './types';

const MAX_BYTES = 2_000_000;
const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const safeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function imageKind(bytes: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}
type CoverExtension = 'jpg' | 'png' | 'webp';

/** Only canonical UUIDs and allowlisted image extensions may reach a filesystem path.
 * The containment check also rejects traversal if this helper changes later.
 */
function pathOf(env: ServiceEnv, itemId: string, accountId: string, ext: CoverExtension) {
  if (!safeId.test(itemId) || !safeId.test(accountId)) throw badRequest('Invalid cover identifiers.');
  if (ext !== 'jpg' && ext !== 'png' && ext !== 'webp') throw badRequest('Invalid cover extension.');
  const base = join(env.mediaPreviewDir, 'social-covers');
  const candidate = join(base, `${itemId}_${accountId}.${ext}`);
  const rel = relative(base, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) throw badRequest('Invalid cover path.');
  return candidate;
}

/** Save a verified cover from either a manual upload or an app-owned Drive JSON template. */
export async function saveSocialCoverBytes(
  ctx: Ctx, projectId: string, itemId: string, accountId: string, bytes: Buffer,
) {
  const [row] = rowsOf<{ id: string }>(await ctx.db.execute(sql`
    select i.id from publish_items i
    join distribution_variants v on v.id=i.variant_id
    join social_accounts sa on sa.id=${accountId} and sa.org_id=${ctx.orgId} and sa.deleted_at is null
    where i.id=${itemId} and i.org_id=${ctx.orgId}
      and v.org_id=${ctx.orgId} and v.project_id=${projectId}
  `));
  if (!row) throw notFound('Video and social account in project');
  if (!bytes.length || bytes.length > MAX_BYTES) throw badRequest('A thumbnail must be 2 MB or smaller.');
  const ext = imageKind(bytes);
  if (!ext) throw badRequest('Upload a JPG, PNG, or WebP thumbnail.');
  await mkdir(join(ctx.env.mediaPreviewDir, 'social-covers'), { recursive: true });
  await writeFile(pathOf(ctx.env, itemId, accountId, ext), bytes);
  for (const other of ['jpg', 'png', 'webp'])
    if (other !== ext) await rm(pathOf(ctx.env, itemId, accountId, other), { force: true });
  return { saved: true, itemId, accountId };
}

export async function saveSocialCover(ctx: Ctx, projectId: string, itemId: string, accountId: string, data: string) {
  const raw = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  return saveSocialCoverBytes(ctx, projectId, itemId, accountId, Buffer.from(raw, 'base64'));
}

/** Restore platform's automatic video frame for one account without touching others. */
export async function deleteSocialCover(ctx: Ctx, projectId: string, itemId: string, accountId: string) {
  const [row] = rowsOf<{ id: string }>(await ctx.db.execute(sql`
    select i.id from publish_items i
    join distribution_variants v on v.id=i.variant_id
    join social_accounts sa on sa.id=${accountId} and sa.org_id=${ctx.orgId} and sa.deleted_at is null
    where i.id=${itemId} and i.org_id=${ctx.orgId}
      and v.org_id=${ctx.orgId} and v.project_id=${projectId}
  `));
  if (!row) throw notFound('Video and social account in project');
  for (const ext of ['jpg', 'png', 'webp']) {
    await rm(pathOf(ctx.env, itemId, accountId, ext), { force: true });
  }
  return { removed: true, itemId, accountId };
}

export async function readSocialCover(
  ctx: Pick<Ctx, 'db' | 'env'>, orgId: string, itemId: string, accountId: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!safeId.test(itemId) || !safeId.test(accountId)) return null;
  const [valid] = rowsOf<{ id: string }>(await ctx.db.execute(sql`
    select i.id from publish_items i
    join social_accounts a on a.id=${accountId} and a.org_id=${orgId}
    where i.id=${itemId} and i.org_id=${orgId}
  `));
  if (!valid) return null;
  for (const [ext, mime] of [['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']] as const) {
    try { return { bytes: await readFile(pathOf(ctx.env, itemId, accountId, ext)), mime }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

export function signSocialCoverToken(secret: string, orgId: string, itemId: string, accountId: string, exp: number) {
  const payload = `social-cover.${orgId}.${itemId}.${accountId}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${hmacHex(secret, payload)}`;
}
export function verifySocialCoverToken(secret: string, token: string, now = Date.now()) {
  const [p, signature] = token.split('.');
  if (!p || !signature) return null;
  const payload = Buffer.from(p, 'base64url').toString('utf8');
  if (!safeEqualHex(hmacHex(secret, payload), signature)) return null;
  const [kind, orgId, itemId, accountId, exp] = payload.split('.');
  if (kind !== 'social-cover' || !orgId || !itemId || !accountId ||
      ![orgId, itemId, accountId].every((id) => safeId.test(id)) ||
      !Number.isFinite(Number(exp)) || Number(exp) < now) return null;
  return { orgId, itemId, accountId };
}
