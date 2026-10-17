import {
  and,
  derivedPreviews,
  eq,
  fileInstances,
  inArray,
  isNull,
  mediaObjects,
  organizations,
  scanObservations,
  scanRuns,
  sql,
  storageRoots,
  type Db,
  type Executor,
} from '@creatoros/db';
import {
  canonicalPath,
  extName,
  baseName,
  ingestBatchSchema,
  isInsideRoot,
  kindFromExtension,
  type FileKind,
  type IngestResponse,
  type Observation,
  type PathOs,
} from '@creatoros/domain';
import { audit, emit } from './audit';
import type { AuthedAgent } from './devices';
import { forbidden, type ServiceEnv } from './types';

type Instance = typeof fileInstances.$inferSelect;

const MTIME_TOLERANCE_MS = 2000;
const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export interface IngestOptions {
  /** Hours a file must stay unseen (and be missing from >= 2 complete scans) before CONFIRMED_MISSING. Default from org settings or 24. */
  missingGraceHours?: number;
  minMissingChecks?: number;
  now?: Date;
}

export async function getOrgNumberSetting(
  db: Executor,
  orgId: string,
  key: string,
  fallback: number,
): Promise<number> {
  const [o] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  const v = (o?.settings as Record<string, unknown> | undefined)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Apply one agent batch. Fully idempotent: every observation carries a unique event id, replays are counted as
 * duplicates and never re-applied (T11). Paths outside the paired root are rejected (T12).
 */
export async function processIngest(
  db: Db,
  env: ServiceEnv,
  agent: AuthedAgent,
  input: unknown,
  opts: IngestOptions = {},
): Promise<IngestResponse> {
  const batch = ingestBatchSchema.parse(input);
  const now = opts.now ?? new Date();
  const [root] = await db.select().from(storageRoots).where(eq(storageRoots.id, batch.rootId));
  if (!root || root.orgId !== agent.orgId || root.deviceId !== agent.deviceId) {
    await audit(
      { db, orgId: agent.orgId, actor: { type: 'agent', id: agent.deviceId }, userId: null },
      'agent.ingest.denied',
      { type: 'storage_root', id: batch.rootId },
    );
    throw forbidden('This storage root is not granted to the authenticated device');
  }
  if (root.state === 'RETIRED') throw forbidden('This storage root has been retired');
  const os = root.pathOs as PathOs;
  const isAlias = Boolean((root.config as any)?.alternatePathFor);
  const graceHours =
    opts.missingGraceHours ?? (await getOrgNumberSetting(db, agent.orgId, 'missingGraceHours', 24));
  const minChecks = opts.minMissingChecks ?? 2;

  return db.transaction(async (tx) => {
    // ---- run bookkeeping
    const [existingRun] = await tx.select().from(scanRuns).where(eq(scanRuns.runId, batch.runId));
    if (existingRun && existingRun.rootId !== root.id) throw forbidden('Run id belongs to another root');
    let run = existingRun;
    if (!run) {
      [run] = await tx
        .insert(scanRuns)
        .values({
          orgId: root.orgId,
          rootId: root.id,
          runId: batch.runId,
          jobType: batch.jobType,
          startedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      run ??= (await tx.select().from(scanRuns).where(eq(scanRuns.runId, batch.runId)))[0];
      await tx
        .update(storageRoots)
        .set({
          // HEARTBEAT runs carry only enrichment (hashes, probes); they are not scans and must not look like one.
          ...(batch.jobType === 'HEARTBEAT'
            ? { lastHeartbeatAt: now }
            : { lastScanAt: now, scanRequestedAt: null }),
          ...(batch.jobType === 'RECONCILE' ? { reconcileRequestedAt: null } : {}),
          ...(root.state === 'UNREACHABLE' ? { state: 'ACTIVE' as const } : {}),
        })
        .where(eq(storageRoots.id, root.id));
    }

    // ---- validate paths, drop duplicates
    let rejected = 0;
    const valid: (Observation & { canonical: string })[] = [];
    for (const o of batch.observations) {
      const c = canonicalPath(o.path, os);
      if (!isInsideRoot(root.canonicalPath, c, os)) {
        rejected += 1;
        continue;
      }
      valid.push({ ...o, canonical: c });
    }
    const insertedEvents = new Set<string>();
    for (const part of chunk(valid, 500)) {
      const rows = await tx
        .insert(scanObservations)
        .values(
          part.map((o) => ({
            orgId: root.orgId,
            rootId: root.id,
            agentEventId: o.eventId,
            sequence: o.seq,
            kind: o.kind,
            path: o.path,
            fileIdentity: o.fileId ?? null,
          })),
        )
        .onConflictDoNothing()
        .returning({ e: scanObservations.agentEventId });
      rows.forEach((r) => insertedEvents.add(r.e));
    }
    const fresh = valid.filter((o) => insertedEvents.has(o.eventId)).sort((a, b) => a.seq - b.seq);
    const duplicates = valid.length - fresh.length;
    let ack = 0;
    for (const o of batch.observations) ack = Math.max(ack, o.seq);

    let newCount = 0;
    let changedCount = 0;
    let scanned = 0;
    let errorCount = 0;
    const runErrors: { path: string; error: string }[] = [...(batch.errors ?? [])];
    const discovered: { id: string; path: string }[] = [];
    const restored: { id: string; path: string }[] = [];

    if (!isAlias) {
      // ---------- pass 1: file observations
      const fileObs = fresh.filter((o) => o.kind === 'file');
      scanned += fileObs.length;
      const byCanon = new Map<string, Observation & { canonical: string }>();
      fileObs.forEach((o) => byCanon.set(o.canonical, o));
      const canonKeys = [...byCanon.keys()];
      const existing = new Map<string, Instance>();
      for (const part of chunk(canonKeys, 1000)) {
        const rows = await tx
          .select()
          .from(fileInstances)
          .where(
            and(
              eq(fileInstances.rootId, root.id),
              isNull(fileInstances.archivedAt),
              inArray(fileInstances.canonicalPath, part),
            ),
          );
        rows.forEach((r) => existing.set(r.canonicalPath, r));
      }

      const touchOnly: string[] = [];
      const toInsert: (typeof fileInstances.$inferInsert)[] = [];
      const moveCandidates: (Observation & { canonical: string })[] = [];

      for (const [canon, o] of byCanon) {
        const ex = existing.get(canon);
        if (!ex) {
          moveCandidates.push(o);
          continue;
        }
        const mtimeDiff = o.mtimeMs ? Math.abs((ex.mtime?.getTime() ?? 0) - o.mtimeMs) : 0;
        const changed =
          ex.size !== o.size ||
          mtimeDiff > Math.max(MTIME_TOLERANCE_MS, o.mtimePrecisionMs ?? 0) ||
          (o.fileId && ex.fileId && o.fileId !== ex.fileId);
        const wasMissing = ex.availability === 'MISSING_CANDIDATE' || ex.availability === 'CONFIRMED_MISSING';
        if (wasMissing) restored.push({ id: ex.id, path: o.path });
        const availability =
          o.state === 'PERMISSION_DENIED'
            ? 'PERMISSION_DENIED'
            : o.state === 'INCOMPLETE'
              ? 'INCOMPLETE'
              : 'AVAILABLE';
        if (changed) {
          changedCount += 1;
          await tx
            .update(fileInstances)
            .set({
              size: o.size,
              mtime: o.mtimeMs ? new Date(o.mtimeMs) : ex.mtime,
              ctime: o.ctimeMs ? new Date(o.ctimeMs) : ex.ctime,
              fileId: o.fileId ?? ex.fileId,
              displayPath: o.path,
              quickSignature: o.quickSignature ?? null,
              // content changed: previous identity/hash/probe no longer describe this file
              fullHash: null,
              hashAlg: null,
              mediaObjectId: null,
              tech: {},
              mime: null,
              probeState: o.state === 'STILL_WRITING' ? 'STILL_WRITING' : 'PENDING',
              stableObservations: o.stableObservations,
              availability,
              missingSince: null,
              missingChecks: 0,
              lastSeenAt: now,
              lastSeenRunId: batch.runId,
            })
            .where(eq(fileInstances.id, ex.id));
          continue;
        }
        let probeState = ex.probeState;
        if (o.state === 'STILL_WRITING' && ex.probeState !== 'INDEXED') probeState = 'STILL_WRITING';
        else if (o.state === 'STABLE' && ex.probeState === 'STILL_WRITING') probeState = 'PENDING';
        const needsUpdate =
          wasMissing ||
          probeState !== ex.probeState ||
          availability !== ex.availability ||
          (o.quickSignature && !ex.quickSignature) ||
          o.stableObservations > ex.stableObservations ||
          o.path !== ex.displayPath;
        if (needsUpdate) {
          await tx
            .update(fileInstances)
            .set({
              probeState,
              availability,
              displayPath: o.path,
              quickSignature: ex.quickSignature ?? o.quickSignature ?? null,
              stableObservations: Math.max(ex.stableObservations, o.stableObservations),
              missingSince: null,
              missingChecks: 0,
              lastSeenAt: now,
              lastSeenRunId: batch.runId,
            })
            .where(eq(fileInstances.id, ex.id));
        } else touchOnly.push(ex.id);
      }
      for (const part of chunk(touchOnly, 1000)) {
        await tx
          .update(fileInstances)
          .set({ lastSeenAt: now, lastSeenRunId: batch.runId })
          .where(inArray(fileInstances.id, part));
      }

      // ---------- moves/renames: same stable file id (+ same size and mtime) at a path we have not seen
      const withId = moveCandidates.filter((o) => o.fileId);
      const movedFrom = new Map<string, Instance>();
      if (withId.length) {
        for (const part of chunk(
          withId.map((o) => o.fileId!),
          1000,
        )) {
          const rows = await tx
            .select()
            .from(fileInstances)
            .where(
              and(
                eq(fileInstances.rootId, root.id),
                isNull(fileInstances.archivedAt),
                inArray(fileInstances.fileId, part),
              ),
            );
          rows.forEach((r) => movedFrom.set(r.fileId!, r));
        }
      }
      for (const o of moveCandidates) {
        const old = o.fileId ? movedFrom.get(o.fileId) : undefined;
        const sameContent =
          old &&
          old.size === o.size &&
          Math.abs((old.mtime?.getTime() ?? 0) - o.mtimeMs) <= MTIME_TOLERANCE_MS;
        const oldStillSeen = old && old.lastSeenRunId === batch.runId; // already reported at its old path in this run -> hard link, not a move
        if (old && sameContent && !oldStillSeen && !existing.has(o.canonical)) {
          await tx
            .update(fileInstances)
            .set({
              canonicalPath: o.canonical,
              displayPath: o.path,
              fileName: baseName(o.path),
              ext: o.ext ?? extName(o.path),
              availability: 'AVAILABLE',
              missingSince: null,
              missingChecks: 0,
              lastSeenAt: now,
              lastSeenRunId: batch.runId,
            })
            .where(eq(fileInstances.id, old.id));
          changedCount += 1;
          movedFrom.delete(o.fileId!);
          continue;
        }
        const ext = (o.ext ?? extName(o.path)).toLowerCase();
        toInsert.push({
          orgId: root.orgId,
          rootId: root.id,
          deviceId: root.deviceId,
          canonicalPath: o.canonical,
          displayPath: o.path,
          fileName: baseName(o.path),
          ext,
          fileId: o.fileId ?? null,
          size: o.size,
          mtime: o.mtimeMs ? new Date(o.mtimeMs) : null,
          ctime: o.ctimeMs ? new Date(o.ctimeMs) : null,
          firstSeenAt: now,
          lastSeenAt: now,
          lastSeenRunId: batch.runId,
          availability:
            o.state === 'PERMISSION_DENIED'
              ? 'PERMISSION_DENIED'
              : o.state === 'INCOMPLETE'
                ? 'INCOMPLETE'
                : 'AVAILABLE',
          quickSignature: o.quickSignature ?? null,
          fileType: kindFromExtension(ext) as FileKind,
          probeState: o.state === 'STILL_WRITING' ? 'STILL_WRITING' : 'PENDING',
          stableObservations: o.stableObservations,
        });
      }
      for (const part of chunk(toInsert, 500)) {
        const rows = await tx
          .insert(fileInstances)
          .values(part)
          .onConflictDoNothing()
          .returning({ id: fileInstances.id, displayPath: fileInstances.displayPath });
        newCount += rows.length;
        rows.forEach((r) => discovered.push({ id: r.id, path: r.displayPath }));
      }

      // ---------- pass 2: hash, probe and embedded hash/probe
      const secondary = fresh.filter(
        (o) => o.kind === 'hash' || o.kind === 'probe' || (o.kind === 'file' && (o.fullHash || o.probe)),
      );
      if (secondary.length) {
        const keys = [...new Set(secondary.map((o) => o.canonical))];
        const inst = new Map<string, Instance>();
        for (const part of chunk(keys, 1000)) {
          const rows = await tx
            .select()
            .from(fileInstances)
            .where(
              and(
                eq(fileInstances.rootId, root.id),
                isNull(fileInstances.archivedAt),
                inArray(fileInstances.canonicalPath, part),
              ),
            );
          rows.forEach((r) => inst.set(r.canonicalPath, r));
        }
        for (const o of secondary) {
          const row = inst.get(o.canonical);
          if (!row) continue;
          if (o.fullHash && (o.kind === 'hash' || o.kind === 'file')) await applyHash(tx, row, o);
          if (o.probe && (o.kind === 'probe' || o.kind === 'file')) await applyProbe(tx, row, o);
          else if (o.kind === 'probe' && o.probeState === 'PROBE_FAILED') {
            await tx
              .update(fileInstances)
              .set({ probeState: 'PROBE_FAILED' })
              .where(eq(fileInstances.id, row.id));
          }
        }
      }

      // ---------- errors
      for (const o of fresh.filter((x) => x.kind === 'error')) {
        errorCount += 1;
        runErrors.push({ path: o.path, error: o.error ?? 'unknown error' });
        // A path the agent could not read still exists as far as we know: it counts as "seen" in this run so the
        // missing-file sweep can never mark it missing, even if the agent (wrongly) reported the scan as complete.
        const denied = /denied|permission|access is denied/i.test(o.error ?? '');
        await tx
          .update(fileInstances)
          .set({
            lastSeenRunId: batch.runId,
            ...(denied ? { availability: 'PERMISSION_DENIED' as const } : {}),
          })
          .where(
            and(
              eq(fileInstances.rootId, root.id),
              eq(fileInstances.canonicalPath, o.canonical),
              isNull(fileInstances.archivedAt),
            ),
          );
      }
    }
    errorCount += batch.errors?.length ?? 0;

    // ---- counters
    await tx
      .update(scanRuns)
      .set({
        scannedCount: sql`${scanRuns.scannedCount} + ${scanned}`,
        newCount: sql`${scanRuns.newCount} + ${newCount}`,
        changedCount: sql`${scanRuns.changedCount} + ${changedCount}`,
        errorCount: sql`${scanRuns.errorCount} + ${errorCount}`,
        errors: runErrors.length
          ? sql`(${scanRuns.errors} || ${JSON.stringify(runErrors.slice(0, 100))}::jsonb)`
          : scanRuns.errors,
      })
      .where(eq(scanRuns.runId, batch.runId));

    // ---- END of run: missing detection (only after a COMPLETE, non-suspicious scan)
    const enrichmentOnly = batch.jobType === 'HEARTBEAT';
    if (batch.phase === 'END' && !isAlias && !enrichmentOnly) {
      const [cur] = await tx.select().from(scanRuns).where(eq(scanRuns.runId, batch.runId));
      const [prior] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(fileInstances)
        .where(
          and(
            eq(fileInstances.rootId, root.id),
            isNull(fileInstances.archivedAt),
            sql`${fileInstances.lastSeenRunId} is distinct from ${batch.runId}::uuid`,
          ),
        );
      const complete = batch.complete === true;
      const suspicious = complete && (cur?.scannedCount ?? 0) === 0 && (prior?.n ?? 0) > 0;
      let missingCount = 0;
      if (complete && !suspicious) {
        const newlyMissing = await tx
          .select({ id: fileInstances.id, displayPath: fileInstances.displayPath })
          .from(fileInstances)
          .where(
            and(
              eq(fileInstances.rootId, root.id),
              isNull(fileInstances.archivedAt),
              sql`${fileInstances.lastSeenRunId} is distinct from ${batch.runId}::uuid`,
              sql`${fileInstances.availability} not in ('MISSING_CANDIDATE','CONFIRMED_MISSING')`,
            ),
          );
        const updated = await tx
          .update(fileInstances)
          .set({
            missingChecks: sql`${fileInstances.missingChecks} + 1`,
            missingSince: sql`coalesce(${fileInstances.missingSince}, ${now.toISOString()}::timestamptz)`,
            availability: sql`case when ${fileInstances.missingChecks} + 1 >= ${minChecks} and coalesce(${fileInstances.missingSince}, ${now.toISOString()}::timestamptz) <= ${now.toISOString()}::timestamptz - make_interval(hours => ${graceHours}) then 'CONFIRMED_MISSING'::file_availability else 'MISSING_CANDIDATE'::file_availability end`,
          })
          .where(
            and(
              eq(fileInstances.rootId, root.id),
              isNull(fileInstances.archivedAt),
              sql`${fileInstances.lastSeenRunId} is distinct from ${batch.runId}::uuid`,
              sql`${fileInstances.availability} <> 'CONFIRMED_MISSING'`,
            ),
          )
          .returning({ id: fileInstances.id });
        missingCount = updated.length;
        for (const m of newlyMissing.slice(0, 200))
          await emit(tx, root.orgId, 'media.file.missing', {
            fileInstanceId: m.id,
            path: m.displayPath,
            rootId: root.id,
          });
      }
      await tx
        .update(scanRuns)
        .set({
          finishedAt: now,
          completeSuccess: complete && !suspicious,
          status: complete && !suspicious ? 'COMPLETED' : runErrors.length ? 'FAILED' : 'ABORTED',
          missingCount,
          errors: suspicious
            ? sql`(${scanRuns.errors} || ${JSON.stringify([{ path: root.displayPath, error: 'Scan reported zero files for a root that previously had files; treated as unreachable, nothing marked missing.' }])}::jsonb)`
            : scanRuns.errors,
        })
        .where(eq(scanRuns.runId, batch.runId));
      await tx
        .update(storageRoots)
        .set(
          complete && !suspicious
            ? {
                lastSuccessfulScanAt: now,
                consecutiveCompleteScans: sql`${storageRoots.consecutiveCompleteScans} + 1`,
                state: root.state === 'UNREACHABLE' ? 'ACTIVE' : root.state,
              }
            : { consecutiveCompleteScans: 0, ...(suspicious ? { state: 'UNREACHABLE' as const } : {}) },
        )
        .where(eq(storageRoots.id, root.id));
    } else if (batch.phase === 'END' && (isAlias || enrichmentOnly)) {
      await tx
        .update(scanRuns)
        .set({ finishedAt: now, status: 'COMPLETED', completeSuccess: false })
        .where(eq(scanRuns.runId, batch.runId));
    }

    for (const d of discovered.slice(0, 200))
      await emit(tx, root.orgId, 'media.file.discovered', {
        fileInstanceId: d.id,
        path: d.path,
        rootId: root.id,
        deviceId: root.deviceId,
      });
    for (const r of restored.slice(0, 200))
      await emit(tx, root.orgId, 'media.file.restored', {
        fileInstanceId: r.id,
        path: r.path,
        rootId: root.id,
      });

    const wantHash =
      root.hashMode === 'candidates' && (batch.phase === 'END' || fresh.length > 0)
        ? await getHashRequestsForRoot(tx, root.id, 200)
        : [];
    const wantPreview = await getPreviewRequests(tx, agent.deviceId, 20);
    return {
      ack,
      accepted: fresh.length,
      duplicates,
      rejected,
      wantHash,
      wantPreview,
      serverTime: now.toISOString(),
    };
  });
}

async function applyHash(tx: Executor, row: Instance, o: Observation): Promise<void> {
  if (!o.fullHash) return;
  // Never trust a hash for a file that is still being written or whose size changed since it was hashed.
  if (row.probeState === 'STILL_WRITING') return;
  if (o.size !== row.size) return;
  if (o.mtimeMs && row.mtime && Math.abs(row.mtime.getTime() - o.mtimeMs) > MTIME_TOLERANCE_MS) return;
  await tx
    .insert(mediaObjects)
    .values({
      orgId: row.orgId,
      exactHash: o.fullHash,
      hashAlg: 'sha256',
      size: row.size,
      kind: row.fileType,
      mime: row.mime,
      tech: row.tech ?? {},
    })
    .onConflictDoNothing();
  const [mo] = await tx
    .select({ id: mediaObjects.id, tech: mediaObjects.tech })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.orgId, row.orgId),
        eq(mediaObjects.hashAlg, 'sha256'),
        eq(mediaObjects.exactHash, o.fullHash),
        eq(mediaObjects.size, row.size),
      ),
    );
  await tx
    .update(fileInstances)
    .set({
      fullHash: o.fullHash,
      hashAlg: 'sha256',
      mediaObjectId: mo?.id ?? null,
      quickSignature: row.quickSignature ?? o.quickSignature ?? null,
    })
    .where(eq(fileInstances.id, row.id));
  if (mo && Object.keys(mo.tech ?? {}).length === 0 && Object.keys(row.tech ?? {}).length > 0) {
    await tx.update(mediaObjects).set({ tech: row.tech }).where(eq(mediaObjects.id, mo.id));
  }
}

async function applyProbe(tx: Executor, row: Instance, o: Observation): Promise<void> {
  if (!o.probe) return;
  if (row.probeState === 'STILL_WRITING') return;
  const p = o.probe;
  let fileType = row.fileType;
  if (p.width && p.height && fileType === 'OTHER') fileType = 'VIDEO';
  if (!p.width && p.hasAudio && fileType === 'OTHER') fileType = 'AUDIO';
  await tx
    .update(fileInstances)
    .set({
      tech: p as Record<string, unknown>,
      mime: p.mime ?? row.mime,
      probeState: o.probeState ?? 'INDEXED',
      fileType,
    })
    .where(eq(fileInstances.id, row.id));
  if (row.mediaObjectId) {
    await tx
      .update(mediaObjects)
      .set({ tech: p as Record<string, unknown>, mime: p.mime ?? row.mime ?? undefined })
      .where(eq(mediaObjects.id, row.mediaObjectId));
  }
}

/** "candidates" hash mode: only hash files that share (size, quick signature) with another file and lack a full hash. */
export async function getHashRequestsForRoot(tx: Executor, rootId: string, limit: number) {
  const rows = await tx.execute(sql`
    select f.display_path as path, f.root_id as "rootId"
    from file_instances f
    where f.root_id = ${rootId}
      and f.archived_at is null
      and f.full_hash is null
      and f.quick_signature is not null
      and f.probe_state <> 'STILL_WRITING'
      and f.availability = 'AVAILABLE'
      and exists (
        select 1 from file_instances g
        where g.org_id = f.org_id and g.id <> f.id and g.archived_at is null
          and g.size = f.size and g.quick_signature = f.quick_signature
      )
    limit ${limit}`);
  return (rows as unknown as { rows: { path: string; rootId: string }[] }).rows;
}

export async function getHashRequests(db: Db, agent: AuthedAgent, limit = 200) {
  const roots = await db
    .select({ id: storageRoots.id })
    .from(storageRoots)
    .where(
      and(
        eq(storageRoots.deviceId, agent.deviceId),
        eq(storageRoots.hashMode, 'candidates'),
        sql`${storageRoots.state} = 'ACTIVE'`,
      ),
    );
  const out: { path: string; rootId: string }[] = [];
  for (const r of roots) out.push(...(await getHashRequestsForRoot(db, r.id, limit)));
  return out.slice(0, limit);
}

/** Thumbnails the agent should generate: stable image/video files that have no derived preview yet. */
export async function getPreviewRequests(tx: Executor, deviceId: string, limit: number) {
  const rows = await tx.execute(sql`
    select f.id as "instanceId", f.display_path as path
    from file_instances f
    where f.device_id = ${deviceId}
      and f.archived_at is null
      and f.file_type in ('VIDEO','IMAGE')
      and f.probe_state = 'INDEXED'
      and f.availability = 'AVAILABLE'
      and not exists (select 1 from derived_previews p where p.file_instance_id = f.id and p.variant_key = 'thumb')
    order by f.first_seen_at desc
    limit ${limit}`);
  return (rows as unknown as { rows: { instanceId: string; path: string }[] }).rows;
}

export { derivedPreviews };
