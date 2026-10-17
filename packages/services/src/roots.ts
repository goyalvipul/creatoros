import { and, devices, eq, fileInstances, ne, sql, storageRoots, physicalShares, scanRuns, desc } from '@creatoros/db';
import { canonicalPath, isInsideRoot, osToPathOs, type PathOs } from '@creatoros/domain';
import { audit } from './audit';
import { badRequest, conflict, notFound, type Ctx } from './types';

export interface RootInput {
  deviceId: string;
  label: string;
  displayPath: string;
  accessMethod?: 'LOCAL' | 'SMB' | 'NFS_MOUNT' | 'SERVER_MOUNT';
  recursive?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  extensions?: string[];
  scanIntervalMinutes?: number;
  settleSeconds?: number;
  hashMode?: 'all' | 'candidates' | 'off';
  followLinks?: boolean;
  smbPath?: string | null;
  mountPath?: string | null;
  physicalShareId?: string | null;
  brandId?: string | null;
  projectId?: string | null;
  autoTagRules?: { pattern: string; tags?: string[]; brandId?: string; projectId?: string }[];
}

export async function createRoot(ctx: Ctx, input: RootInput) {
  const [device] = await ctx.db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.orgId, ctx.orgId)));
  if (!device) throw notFound('Device');
  if (device.state === 'REVOKED') throw badRequest('This device has been revoked.');
  const display = input.displayPath.trim();
  if (!display) throw badRequest('Path is required');
  const os: PathOs = osToPathOs(device.os, display);
  const canonical = canonicalPath(display, os);

  // A root nested inside (or wrapping) another active root on the same device would double count every file.
  const siblings = await ctx.db
    .select()
    .from(storageRoots)
    .where(and(eq(storageRoots.deviceId, device.id), ne(storageRoots.state, 'RETIRED')));
  for (const s of siblings) {
    if (s.canonicalPath === canonical) throw conflict(`A scan root for ${s.displayPath} already exists on this device.`, { rootId: s.id }, 'ROOT_EXISTS');
    if (isInsideRoot(s.canonicalPath, canonical, os) || isInsideRoot(canonical, s.canonicalPath, os)) {
      throw conflict(
        `This path overlaps the existing root ${s.displayPath}. Overlapping roots would index the same files twice; use include/exclude globs on one root instead.`,
        { rootId: s.id },
        'ROOT_OVERLAP',
      );
    }
  }

  let config: Record<string, unknown> = {};
  if (input.physicalShareId) {
    const [share] = await ctx.db.select().from(physicalShares).where(and(eq(physicalShares.id, input.physicalShareId), eq(physicalShares.orgId, ctx.orgId)));
    if (!share) throw notFound('Physical share');
    // One physical share identity: the first root that scans it is primary; further roots are alternate access paths only.
    const [primary] = await ctx.db
      .select()
      .from(storageRoots)
      .where(and(eq(storageRoots.physicalShareId, share.id), ne(storageRoots.state, 'RETIRED')))
      .orderBy(storageRoots.createdAt)
      .limit(1);
    if (primary) config = { alternatePathFor: (primary.config as any)?.alternatePathFor ?? primary.id };
  }

  const [root] = await ctx.db
    .insert(storageRoots)
    .values({
      orgId: ctx.orgId,
      deviceId: device.id,
      label: input.label,
      displayPath: display,
      canonicalPath: canonical,
      pathOs: os,
      smbPath: input.smbPath ?? null,
      mountPath: input.mountPath ?? null,
      accessMethod: input.accessMethod ?? 'LOCAL',
      recursive: input.recursive ?? true,
      includeGlobs: input.includeGlobs ?? [],
      excludeGlobs: input.excludeGlobs ?? [],
      extensions: (input.extensions ?? []).map((e) => e.replace(/^\./, '').toLowerCase()),
      scanIntervalMinutes: input.scanIntervalMinutes ?? 360,
      settleSeconds: input.settleSeconds ?? 60,
      hashMode: input.hashMode ?? 'all',
      followLinks: input.followLinks ?? false,
      physicalShareId: input.physicalShareId ?? null,
      brandId: input.brandId ?? null,
      projectId: input.projectId ?? null,
      autoTagRules: input.autoTagRules ?? [],
      state: 'ACTIVE',
      scanRequestedAt: ctx.now(), // first scan starts as soon as the agent next polls
      config,
    })
    .returning();
  await audit(ctx, 'storage_root.create', { type: 'storage_root', id: root.id }, undefined, { path: display, device: device.displayName });
  return root;
}

export async function updateRoot(ctx: Ctx, id: string, patch: Partial<Omit<RootInput, 'deviceId' | 'displayPath'>>) {
  const [existing] = await ctx.db.select().from(storageRoots).where(and(eq(storageRoots.id, id), eq(storageRoots.orgId, ctx.orgId)));
  if (!existing) throw notFound('Storage root');
  const set: Record<string, unknown> = {};
  for (const k of ['label', 'recursive', 'includeGlobs', 'excludeGlobs', 'scanIntervalMinutes', 'settleSeconds', 'hashMode', 'followLinks', 'smbPath', 'mountPath', 'brandId', 'projectId', 'autoTagRules', 'accessMethod'] as const) {
    if ((patch as any)[k] !== undefined) set[k] = (patch as any)[k];
  }
  if (patch.extensions) set.extensions = patch.extensions.map((e) => e.replace(/^\./, '').toLowerCase());
  const [row] = await ctx.db.update(storageRoots).set(set).where(eq(storageRoots.id, id)).returning();
  await audit(ctx, 'storage_root.update', { type: 'storage_root', id }, undefined, set);
  return row;
}

export async function requestScan(ctx: Ctx, id: string, kind: 'scan' | 'reconcile' = 'scan') {
  const [row] = await ctx.db
    .update(storageRoots)
    .set(kind === 'scan' ? { scanRequestedAt: ctx.now() } : { reconcileRequestedAt: ctx.now() })
    .where(and(eq(storageRoots.id, id), eq(storageRoots.orgId, ctx.orgId), ne(storageRoots.state, 'RETIRED')))
    .returning();
  if (!row) throw notFound('Storage root');
  await audit(ctx, `storage_root.${kind}_requested`, { type: 'storage_root', id });
  return row;
}

export async function setRootState(ctx: Ctx, id: string, state: 'ACTIVE' | 'PAUSED' | 'RETIRED') {
  const [existing] = await ctx.db.select().from(storageRoots).where(and(eq(storageRoots.id, id), eq(storageRoots.orgId, ctx.orgId)));
  if (!existing) throw notFound('Storage root');
  await ctx.db.transaction(async (tx) => {
    await tx.update(storageRoots).set({ state, retiredAt: state === 'RETIRED' ? ctx.now() : null }).where(eq(storageRoots.id, id));
    if (state === 'RETIRED') {
      // Non-destructive: records are archived (hidden from inventory) but kept for history. Originals are untouched.
      await tx.update(fileInstances).set({ archivedAt: ctx.now() }).where(and(eq(fileInstances.rootId, id), sql`${fileInstances.archivedAt} is null`));
    }
    await audit({ ...ctx, db: tx }, `storage_root.${state.toLowerCase()}`, { type: 'storage_root', id });
  });
  return { ok: true };
}

export async function listRoots(ctx: Ctx) {
  return ctx.db
    .select({
      root: storageRoots,
      deviceName: devices.displayName,
      deviceState: devices.state,
      fileCount: sql<number>`(select count(*)::int from file_instances f where f.root_id = ${storageRoots.id} and f.archived_at is null)`,
      missingCount: sql<number>`(select count(*)::int from file_instances f where f.root_id = ${storageRoots.id} and f.archived_at is null and f.availability in ('MISSING_CANDIDATE','CONFIRMED_MISSING'))`,
      stillWritingCount: sql<number>`(select count(*)::int from file_instances f where f.root_id = ${storageRoots.id} and f.archived_at is null and f.probe_state = 'STILL_WRITING')`,
      totalBytes: sql<number>`(select coalesce(sum(f.size),0)::bigint from file_instances f where f.root_id = ${storageRoots.id} and f.archived_at is null and f.availability <> 'CONFIRMED_MISSING')`,
    })
    .from(storageRoots)
    .innerJoin(devices, eq(devices.id, storageRoots.deviceId))
    .where(eq(storageRoots.orgId, ctx.orgId))
    .orderBy(devices.displayName, storageRoots.label);
}

export async function listScanRuns(ctx: Ctx, rootId?: string, limit = 50) {
  return ctx.db
    .select()
    .from(scanRuns)
    .where(and(eq(scanRuns.orgId, ctx.orgId), rootId ? eq(scanRuns.rootId, rootId) : undefined))
    .orderBy(desc(scanRuns.startedAt))
    .limit(Math.min(limit, 200));
}

export async function createPhysicalShare(ctx: Ctx, input: { name: string; host?: string; shareName?: string; uncPath?: string; notes?: string }) {
  const [row] = await ctx.db
    .insert(physicalShares)
    .values({ orgId: ctx.orgId, name: input.name, host: input.host ?? null, shareName: input.shareName ?? null, uncPath: input.uncPath ?? null, notes: input.notes ?? null })
    .returning();
  await audit(ctx, 'physical_share.create', { type: 'physical_share', id: row.id });
  return row;
}
