import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  and,
  desc,
  devices,
  eq,
  fileInstances,
  livePlaylists,
  liveSessions,
  liveUploads,
  providerConnections,
  socialAccounts,
  sql,
  streamMachines,
  type Db,
} from '@creatoros/db';
import {
  LIVE_ENDED_TEXT,
  LIVE_REPLAY_TEXT,
  broadcastStopAt,
  ingestionSafetyAt,
  isUnderRoot,
  liveSessionActive,
  machineReady,
  notificationDue,
  notifyBody,
  redactStreamSecrets,
  resolveUnderRoot,
  sessionPolicy,
  stopDue,
  studioLink,
  tightenDeadline,
  watchLink,
  youtubeLivePermitted,
} from '@creatoros/domain';
import {
  bindLiveBroadcast,
  createIngestionStream,
  createLiveBroadcast,
  ensureFreshToken,
  readIngestion,
  readLiveBroadcast,
  readLiveVideo,
  refreshGoogleToken,
  setLiveAgeRestriction,
  setLivePaidPromotion,
  setLiveThumbnail,
  transitionLiveBroadcast,
  updateLiveMonetization,
  updateLiveVideo,
} from '@creatoros/connectors';
import { audit } from './audit';
import { encryptJson, decryptJson, signMediaToken } from './crypto';
import { connectorContext } from './integrations';
import { notify } from './notifications';
import { conflict, notFound, unprocessable, type Ctx, type ServiceEnv } from './types';

const PREPARE_LIMIT_MS = 2 * 60 * 60 * 1000;
type FetchFn = typeof fetch;
type Item = {
  id: string;
  source: 'library' | 'upload' | 'agent';
  name: string;
  fileInstanceId?: string;
  uploadId?: string;
  agentRoot?: string;
  agentRelative?: string;
  path?: string;
  size?: number | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio?: boolean | null;
  sha256?: string | null;
  validation?: 'pending' | 'ok' | 'failed';
};
type Settings = {
  description?: string;
  tags?: string[];
  categoryId?: string;
  language?: string;
  privacy?: 'public' | 'unlisted' | 'private';
  madeForKids?: boolean;
  synthetic?: boolean | null;
  ageRestricted?: boolean;
  paidPromotion?: boolean | null;
  ads?: 'unset' | 'on' | 'off';
  captions?: 'off' | 'embedded';
  license?: 'youtube' | 'creativeCommon';
  enableDvr?: boolean;
  enableEmbed?: boolean;
  recordFromStart?: boolean;
  enableAutoStart?: boolean;
  enableAutoStop?: boolean;
  latency?: 'normal' | 'low' | 'ultraLow';
  loop?: boolean;
  resolution?: '720p' | '1080p';
  mode?: 'youtube' | 'manual';
  scheduledStart?: string | null;
  thumbnailFileId?: string | null;
};

const clean = (e: unknown) => redactStreamSecrets(e instanceof Error ? e.message : String(e)).slice(0, 400);

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function asItems(value: unknown): Item[] {
  return Array.isArray(value) ? (value as Item[]) : [];
}

function asSettings(value: unknown): Settings {
  const s = (value ?? {}) as Settings;
  delete (s as { streamKey?: unknown }).streamKey;
  delete (s as { rtmpUrl?: unknown }).rtmpUrl;
  return s;
}

function publicSession(row: typeof liveSessions.$inferSelect, machineName: string | null, channel: string | null) {
  const settings = asSettings(row.settings);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    stopReason: row.stopReason,
    error: row.error ? redactStreamSecrets(row.error) : null,
    playlistId: row.playlistId,
    playlistName: row.playlistName,
    machineId: row.machineId,
    machineName,
    channel,
    socialAccountId: row.socialAccountId,
    watchUrl: row.watchUrl,
    studioUrl: studioLink(row.youtubeBroadcastId),
    youtubeBroadcastId: row.youtubeBroadcastId,
    replayStatus: row.replayStatus,
    replayDetail: row.replayDetail,
    settings,
    items: asItems(row.playlistSnapshot),
    progress: row.progress ?? {},
    logExcerpt: row.logExcerpt ? redactStreamSecrets(row.logExcerpt) : null,
    policyNotifyMs: row.policyNotifyMs,
    policyStopMs: row.policyStopMs,
    jobCreatedAt: row.jobCreatedAt,
    preparationStartedAt: row.preparationStartedAt,
    encoderStartedAt: row.encoderStartedAt,
    firstIngestAt: row.firstIngestAt,
    youtubeActualStartAt: row.youtubeActualStartAt,
    youtubeActualEndAt: row.youtubeActualEndAt,
    notifyAt: row.notifyAt,
    autoStopAt: row.autoStopAt,
    ingestSafetyAt: row.ingestSafetyAt,
    encoderStoppedAt: row.encoderStoppedAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    verifiedLiveMs: row.verifiedLiveMs,
    verifiedAt: row.verifiedAt,
    mode: settings.mode ?? 'youtube',
    manualLimits:
      settings.mode === 'manual'
        ? 'Manual RTMPS does not set the title, privacy, or replay. Those stay in YouTube Studio, and Kemokem cannot complete that broadcast.'
        : null,
  };
}

async function names(db: Db, row: typeof liveSessions.$inferSelect) {
  const [machine] = row.machineId
    ? await db
        .select({ displayName: streamMachines.displayName })
        .from(streamMachines)
        .where(eq(streamMachines.id, row.machineId))
    : [undefined];
  const [account] = row.socialAccountId
    ? await db.select({ handle: socialAccounts.handle }).from(socialAccounts).where(eq(socialAccounts.id, row.socialAccountId))
    : [undefined];
  return publicSession(row, machine?.displayName ?? (row.machineId ? 'Removed computer' : 'This Kemokem server'), account?.handle ?? null);
}

async function ownedSession(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.id, id), eq(liveSessions.orgId, ctx.orgId)));
  if (!row) throw notFound('Livestream');
  return row;
}

export function liveUploadPath(env: ServiceEnv, orgId: string, uploadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId) || !/^[0-9a-f-]{36}$/i.test(orgId)) throw notFound('File');
  const root = path.resolve(env.liveUploadDir);
  const full = path.resolve(root, orgId, uploadId);
  if (full !== path.join(root, orgId, uploadId)) throw notFound('File');
  return full;
}

export async function liveState(ctx: Ctx) {
  const [active] = await ctx.db
    .select()
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.orgId, ctx.orgId),
        sql`${liveSessions.status} in ('PREPARING','READY','CREATING','CONNECTING','LIVE','INTERRUPTED','STOPPING')`,
      ),
    )
    .orderBy(desc(liveSessions.jobCreatedAt))
    .limit(1);
  return {
    active: active ? await names(ctx.db, active) : null,
    notifyMinutes: Math.round(ctx.env.liveNotifyAfterMs / 60_000),
    stopMinutes: Math.round(ctx.env.liveAutoStopMs / 60_000),
  };
}

export async function listLiveAccounts(ctx: Ctx) {
  const rows = await ctx.db
    .select({
      id: socialAccounts.id,
      handle: socialAccounts.handle,
      connectionId: socialAccounts.providerConnectionId,
    })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.orgId, ctx.orgId), eq(socialAccounts.platform, 'youtube'), sql`${socialAccounts.deletedAt} is null`));
  const out = [];
  for (const row of rows) {
    const [conn] = row.connectionId
      ? await ctx.db.select({ scopes: providerConnections.scopes, state: providerConnections.state }).from(providerConnections).where(eq(providerConnections.id, row.connectionId))
      : [undefined];
    out.push({
      id: row.id,
      handle: row.handle,
      connectionState: conn?.state ?? 'NOT_CONFIGURED',
      livePermission: youtubeLivePermitted(conn?.scopes),
    });
  }
  return out;
}

export async function listStreamMachines(ctx: Ctx) {
  const rows = await ctx.db.select().from(streamMachines).where(eq(streamMachines.orgId, ctx.orgId)).orderBy(desc(streamMachines.createdAt));
  const now = ctx.now();
  return rows.map((m) => {
    const ready = machineReady(m, now, ctx.env.agentOfflineAfterSeconds * 1000);
    return {
      id: m.id,
      displayName: m.displayName,
      os: m.os,
      ffmpeg: m.ffmpeg,
      encoders: m.encoders,
      freeBytes: m.freeBytes,
      totalBytes: m.totalBytes,
      roots: m.roots,
      browsePath: m.browsePath,
      browseListing: m.browseListing ?? [],
      lastSeenAt: m.lastSeenAt,
      revokedAt: m.revokedAt,
      currentSessionId: m.currentSessionId,
      ready: ready.ok && !m.currentSessionId,
      reason: m.currentSessionId ? 'Running a livestream' : ready.reason,
    };
  });
}

export async function createStreamMachine(ctx: Ctx, input: { displayName: string; os: 'windows' | 'linux' | 'mac' }) {
  const token = `csl_${randomBytes(32).toString('base64url')}`;
  const [row] = await ctx.db
    .insert(streamMachines)
    .values({
      orgId: ctx.orgId,
      displayName: input.displayName.trim(),
      os: input.os,
      tokenHash: tokenHash(token),
    })
    .returning();
  await audit(ctx, 'live.machine.create', { type: 'stream_machine', id: row!.id }, null, { displayName: row!.displayName });
  return { id: row!.id, displayName: row!.displayName, token };
}

export async function updateStreamRoots(ctx: Ctx, id: string, roots: string[]) {
  const cleanRoots = roots.map((r) => r.trim()).filter(Boolean);
  if (cleanRoots.some((r) => r.includes('..') || r.includes('\0'))) throw unprocessable('A media folder cannot contain ..');
  const [row] = await ctx.db
    .update(streamMachines)
    .set({
      roots: cleanRoots,
      browsePath: cleanRoots[0] ?? null,
      browseListing: [],
      updatedAt: new Date(),
    })
    .where(and(eq(streamMachines.id, id), eq(streamMachines.orgId, ctx.orgId), sql`${streamMachines.revokedAt} is null`))
    .returning();
  if (!row) throw notFound('Streaming computer');
  await audit(ctx, 'live.machine.roots', { type: 'stream_machine', id }, null, { roots: cleanRoots });
  return { id: row.id, roots: row.roots };
}

export async function browseStreamMachine(ctx: Ctx, id: string, browsePath: string) {
  const [machine] = await ctx.db
    .select()
    .from(streamMachines)
    .where(and(eq(streamMachines.id, id), eq(streamMachines.orgId, ctx.orgId)));
  if (!machine || machine.revokedAt) throw notFound('Streaming computer');
  if (!(machine.roots ?? []).some((root) => isUnderRoot(root, browsePath)))
    throw unprocessable('That folder is outside the approved media folders.');
  await ctx.db.update(streamMachines).set({ browsePath, browseListing: [], updatedAt: new Date() }).where(eq(streamMachines.id, id));
  return { browsePath };
}

export async function deleteStreamMachine(ctx: Ctx, id: string) {
  const [machine] = await ctx.db
    .select({ id: streamMachines.id })
    .from(streamMachines)
    .where(and(eq(streamMachines.id, id), eq(streamMachines.orgId, ctx.orgId)));
  if (!machine) throw notFound('Streaming computer');
  const [active] = await ctx.db
    .select({ id: liveSessions.id })
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.machineId, id),
        sql`${liveSessions.status} in ('PREPARING','READY','CREATING','CONNECTING','LIVE','INTERRUPTED','STOPPING')`,
      ),
    )
    .limit(1);
  if (active) throw conflict('Stop the livestream on this computer before deleting it.');
  await ctx.db.delete(streamMachines).where(and(eq(streamMachines.id, id), eq(streamMachines.orgId, ctx.orgId)));
  await audit(ctx, 'live.machine.delete', { type: 'stream_machine', id });
  return { id, deleted: true };
}

export async function revokeStreamMachine(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .update(streamMachines)
    .set({ revokedAt: new Date(), updatedAt: new Date(), tokenHash: tokenHash(randomUUID()) })
    .where(and(eq(streamMachines.id, id), eq(streamMachines.orgId, ctx.orgId)))
    .returning({ id: streamMachines.id });
  if (!row) throw notFound('Streaming computer');
  await audit(ctx, 'live.machine.revoke', { type: 'stream_machine', id });
  return { id, revoked: true };
}

export async function listLivePlaylists(ctx: Ctx) {
  return ctx.db
    .select({ id: livePlaylists.id, name: livePlaylists.name, items: livePlaylists.items, updatedAt: livePlaylists.updatedAt })
    .from(livePlaylists)
    .where(and(eq(livePlaylists.orgId, ctx.orgId), sql`${livePlaylists.deletedAt} is null`))
    .orderBy(desc(livePlaylists.updatedAt));
}

export async function saveLivePlaylist(ctx: Ctx, input: { id?: string | null; name: string; items: unknown[] }) {
  const items = input.items.slice(0, 200) as Record<string, unknown>[];
  if (input.id) {
    const [row] = await ctx.db
      .update(livePlaylists)
      .set({ name: input.name.trim(), items, updatedAt: new Date() })
      .where(and(eq(livePlaylists.id, input.id), eq(livePlaylists.orgId, ctx.orgId)))
      .returning();
    if (!row) throw notFound('Playlist');
    return row;
  }
  const [row] = await ctx.db
    .insert(livePlaylists)
    .values({ orgId: ctx.orgId, name: input.name.trim(), items })
    .returning();
  return row!;
}

export async function recordLiveUpload(
  ctx: Ctx,
  file: { id: string; name: string; relativePath: string | null; byteSize: number; sha256: string; mime: string },
) {
  const id = file.id;
  await ctx.db.insert(liveUploads).values({
    id,
    orgId: ctx.orgId,
    fileName: file.name.slice(0, 300),
    relativePath: file.relativePath?.slice(0, 500) ?? null,
    byteSize: file.byteSize,
    sha256: file.sha256,
    mime: file.mime.slice(0, 80),
  });
  return { id, name: file.name, size: file.byteSize, sha256: file.sha256, relativePath: file.relativePath };
}

async function snapshotItems(
  incoming: { source: Item['source']; name?: string; fileInstanceId?: string; uploadId?: string; agentRelative?: string }[],
  folder: string,
): Promise<Item[]> {
  if (!incoming.length) throw unprocessable('Add at least one video.');
  if (incoming.length > 200) throw unprocessable('A livestream playlist can hold 200 videos.');
  const items: Item[] = [];
  for (const raw of incoming) {
    if (raw.source === 'library' || raw.source === 'upload') {
      throw unprocessable('Videos are read from C:\\MehakLive on the RTX 3060. They are not copied over the network.');
    } else if (raw.source === 'agent') {
      const name = (raw.agentRelative || raw.name || '').split(/[/\\]/).pop() || '';
      if (!name || name.includes('..') || /[\\/:*?"<>|]/.test(name) || name.toLowerCase() === 'live.mp4' || name.toLowerCase() === 'normalised' || name.toLowerCase() === 'normalized')
        throw unprocessable(`Choose a video file inside ${folder}. ${name || 'That name'} was rejected.`);
      if (!/\.(mp4|mov|mkv|webm)$/i.test(name)) throw unprocessable(`${name} is not a video file.`);
      const root = folder.replace(/[/\\]+$/, '');
      const sep = root.includes('\\') ? '\\' : '/';
      items.push({
        id: randomUUID(),
        source: 'agent',
        name,
        agentRoot: root,
        agentRelative: name,
        path: `${root}${sep}${name}`,
        validation: 'pending',
      });
    } else throw unprocessable('Unknown video source.');
  }
  return items;
}

async function youtubeToken(ctx: Ctx, accountId: string) {
  const [account] = await ctx.db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.orgId, ctx.orgId)));
  if (!account || account.platform !== 'youtube' || !account.providerConnectionId)
    throw unprocessable('Choose a connected YouTube channel.');
  const [conn] = await ctx.db.select().from(providerConnections).where(eq(providerConnections.id, account.providerConnectionId));
  if (!conn) throw unprocessable('YouTube is not connected.');
  if (!youtubeLivePermitted(conn.scopes))
    throw unprocessable('YouTube is connected without livestream permission. In Integrations, press Enable comments. Livestreams use that youtube.force-ssl permission. Upload permission alone cannot create a broadcast.');
  const token = await ensureFreshToken(connectorContext(ctx.db, ctx.env, conn), refreshGoogleToken);
  return { token, account };
}

export async function createLiveSession(
  ctx: Ctx,
  input: {
    machineId?: string | null;
    socialAccountId?: string | null;
    playlistId?: string | null;
    playlistName?: string | null;
    title: string;
    items: { source: Item['source']; name?: string; fileInstanceId?: string; uploadId?: string; agentRelative?: string }[];
    settings: Settings;
    stopMinutes?: number | null;
    rtmpUrl?: string | null;
    streamKey?: string | null;
  },
) {
  const title = input.title.trim() || 'Livestream';
  if (title.length > 100) throw unprocessable('The title has to be 1 to 100 characters.');
  const policy = (() => {
    try {
      return sessionPolicy(ctx.env.liveNotifyAfterMs, ctx.env.liveAutoStopMs, input.stopMinutes);
    } catch (e) {
      throw unprocessable(clean(e));
    }
  })();
  const machine = input.machineId
    ? (
        await ctx.db
          .select()
          .from(streamMachines)
          .where(and(eq(streamMachines.id, input.machineId), eq(streamMachines.orgId, ctx.orgId)))
      )[0]
    : null;
  if (!machine) throw unprocessable('Choose the computer that will run the livestream.');
  const ready = machineReady(machine, ctx.now(), ctx.env.agentOfflineAfterSeconds * 1000);
  if (!ready.ok) throw unprocessable(ready.reason);
  if (machine.currentSessionId) throw conflict('That computer is already running a livestream.');
  const folder = machine.browsePath || machine.roots?.find(Boolean) || 'C:\\MehakLive';
  const items = await snapshotItems(input.items, folder);
  const known = items.reduce((sum, item) => sum + (item.size ?? 0), 0);
  const need = items.some((item) => item.size == null) ? Math.max(known * 2, 5 * 1024 ** 3) : Math.max(known * 2, 1);
  if (machine.freeBytes != null && machine.freeBytes < need)
    throw unprocessable('There is not enough free disk on that computer to prepare these videos.');
  const settings = asSettings(input.settings);
  settings.mode = settings.mode === 'manual' ? 'manual' : 'youtube';
  settings.privacy = settings.privacy ?? 'public';
  settings.resolution = settings.resolution === '720p' ? '720p' : '1080p';
  settings.description = (settings.description ?? '').slice(0, 5000);
  settings.categoryId = settings.categoryId || '10';
  settings.language = settings.language || 'en';
  const now = ctx.now();
  try {
    const [row] = await ctx.db
      .insert(liveSessions)
      .values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        playlistId: input.playlistId ?? null,
        machineId: machine.id,
        socialAccountId: null,
        title,
        playlistName: input.playlistName ?? null,
        status: 'PREPARING',
        settings,
        playlistSnapshot: items,
        ingestSecret: null,
        policyNotifyMs: policy.notifyAfterMs,
        policyStopMs: policy.autoStopMs,
        jobCreatedAt: now,
        preparationStartedAt: now,
      })
      .returning();
    await ctx.db
      .update(streamMachines)
      .set({ currentSessionId: row!.id, updatedAt: now })
      .where(eq(streamMachines.id, machine.id));
    await audit(ctx, 'live.session.start', { type: 'live_session', id: row!.id }, null, {
      title,
      machineId: machine.id,
      mode: settings.mode,
    });
    return names(ctx.db, row!);
  } catch (e) {
    if (String(e).includes('live_sessions_one_active'))
      throw conflict('A livestream is already running on that computer or that YouTube channel.');
    throw e;
  }
}

export async function listLiveSessions(ctx: Ctx, history: boolean) {
  const rows = await ctx.db
    .select()
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.orgId, ctx.orgId),
        history
          ? sql`${liveSessions.status} in ('ENDED','FAILED')`
          : sql`${liveSessions.status} not in ('ENDED','FAILED')`,
      ),
    )
    .orderBy(desc(liveSessions.jobCreatedAt))
    .limit(50);
  return Promise.all(rows.map((row) => names(ctx.db, row)));
}

export async function getLiveSession(ctx: Ctx, id: string) {
  return names(ctx.db, await ownedSession(ctx, id));
}

export async function startLiveSession(
  ctx: Ctx,
  id: string,
  input: {
    socialAccountId?: string | null;
    title: string;
    settings: Settings;
    stopMinutes?: number | null;
    rtmpUrl?: string | null;
    streamKey?: string | null;
  },
) {
  const row = await ownedSession(ctx, id);
  if (row.status !== 'READY')
    throw unprocessable('The video has to be saved on the computer before YouTube can start.');
  const title = input.title.trim();
  if (title.length < 1 || title.length > 100) throw unprocessable('The title has to be 1 to 100 characters.');
  const policy = (() => {
    try {
      return sessionPolicy(ctx.env.liveNotifyAfterMs, ctx.env.liveAutoStopMs, input.stopMinutes);
    } catch (e) {
      throw unprocessable(clean(e));
    }
  })();
  const settings = { ...asSettings(row.settings), ...asSettings(input.settings) };
  settings.mode = settings.mode === 'manual' ? 'manual' : 'youtube';
  settings.privacy = settings.privacy ?? 'public';
  settings.resolution = settings.resolution === '720p' ? '720p' : '1080p';
  settings.description = (settings.description ?? '').slice(0, 5000);
  settings.categoryId = settings.categoryId || '10';
  settings.language = settings.language || 'en';
  let ingest: string | null = null;
  let accountId: string | null = null;
  if (settings.mode === 'manual') {
    const url = (input.rtmpUrl ?? '').trim();
    const key = (input.streamKey ?? '').trim();
    if (!url.startsWith('rtmps://') || /\s/.test(url) || key.length < 4 || /\s/.test(key))
      throw unprocessable('Manual mode needs an rtmps address and a stream key. The key is stored encrypted and is not shown again.');
    ingest = encryptJson({ address: url.replace(/\/$/, ''), name: key }, ctx.env.encryptionKey);
  } else {
    if (!input.socialAccountId) throw unprocessable('Choose a YouTube channel.');
    await youtubeToken(ctx, input.socialAccountId);
    accountId = input.socialAccountId;
  }
  const now = ctx.now();
  const [updated] = await ctx.db
    .update(liveSessions)
    .set({
      title,
      socialAccountId: accountId,
      settings,
      ingestSecret: ingest,
      policyNotifyMs: policy.notifyAfterMs,
      policyStopMs: policy.autoStopMs,
      updatedAt: now,
    })
    .where(and(eq(liveSessions.id, row.id), eq(liveSessions.status, 'READY')))
    .returning();
  if (!updated) throw conflict('That video is no longer waiting to go live.');
  await ensureBroadcast(ctx.db, ctx.env, updated, fetch);
  const [fresh] = await ctx.db.select().from(liveSessions).where(eq(liveSessions.id, row.id));
  await audit(ctx, 'live.session.broadcast', { type: 'live_session', id }, null, { title, mode: settings.mode });
  return names(ctx.db, fresh!);
}

export async function duplicateLiveSession(ctx: Ctx, id: string) {
  const row = await ownedSession(ctx, id);
  if (liveSessionActive(row.status)) throw conflict('This livestream is still running. Duplicate it after it ends.');
  const settings = asSettings(row.settings);
  return { title: row.title, playlistName: row.playlistName, settings, items: asItems(row.playlistSnapshot) };
}

async function releaseMachine(db: Db, row: { id: string; machineId: string | null }, now: Date) {
  if (!row.machineId) return;
  await db
    .update(streamMachines)
    .set({ currentSessionId: null, updatedAt: now })
    .where(and(eq(streamMachines.id, row.machineId), eq(streamMachines.currentSessionId, row.id)));
}

export async function stopLiveSession(ctx: Ctx, id: string, force: boolean) {
  const row = await ownedSession(ctx, id);
  if (row.status === 'PREPARING' || row.status === 'READY') {
    const now = ctx.now();
    const [next] = await ctx.db
      .update(liveSessions)
      .set({
        status: 'ENDED',
        stopReason: force ? 'EMERGENCY' : 'MANUAL',
        error: row.status === 'PREPARING' ? 'Stopped before the video was saved.' : null,
        updatedAt: now,
      })
      .where(eq(liveSessions.id, row.id))
      .returning();
    await releaseMachine(ctx.db, row, now);
    await audit(ctx, force ? 'live.session.force_stop' : 'live.session.stop', { type: 'live_session', id });
    return names(ctx.db, next!);
  }
  if (!liveSessionActive(row.status)) return names(ctx.db, row);
  const now = ctx.now();
  const [next] = await ctx.db
    .update(liveSessions)
    .set({
      status: 'STOPPING',
      stopReason: force ? 'EMERGENCY' : row.stopReason ?? 'MANUAL',
      updatedAt: now,
    })
    .where(eq(liveSessions.id, row.id))
    .returning();
  await audit(ctx, force ? 'live.session.force_stop' : 'live.session.stop', { type: 'live_session', id });
  return names(ctx.db, next!);
}

async function machineFromToken(db: Db, token: string) {
  const [row] = await db.select().from(streamMachines).where(eq(streamMachines.tokenHash, tokenHash(token)));
  if (!row || row.revokedAt) return null;
  return row;
}

export async function streamHeartbeat(
  db: Db,
  token: string,
  body: {
    os?: string;
    hostname?: string | null;
    ffmpeg?: string | null;
    encoders?: string[];
    freeBytes?: number | null;
    totalBytes?: number | null;
    listing?: { name: string; relative: string; kind: 'dir' | 'video'; size: number }[] | null;
  },
) {
  const machine = await machineFromToken(db, token);
  if (!machine) return null;
  const now = new Date();
  const listing = Array.isArray(body.listing) ? body.listing.slice(0, 500) : undefined;
  await db
    .update(streamMachines)
    .set({
      os: body.os === 'windows' || body.os === 'mac' || body.os === 'linux' ? body.os : machine.os,
      hostname: body.hostname?.slice(0, 200) || machine.hostname,
      ffmpeg: body.ffmpeg?.slice(0, 80) ?? machine.ffmpeg,
      encoders: (body.encoders ?? machine.encoders).slice(0, 20),
      freeBytes: body.freeBytes ?? machine.freeBytes,
      totalBytes: body.totalBytes ?? machine.totalBytes,
      browsePath: machine.browsePath || 'C:\\MehakLive',
      browseListing: listing ?? machine.browseListing,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(streamMachines.id, machine.id));
  if (machine.currentSessionId) {
    const [session] = await db.select().from(liveSessions).where(eq(liveSessions.id, machine.currentSessionId));
    if (session && session.status === 'INTERRUPTED') {
      await db.update(liveSessions).set({ status: 'LIVE', lastHeartbeatAt: now, updatedAt: now }).where(eq(liveSessions.id, session.id));
    } else if (session && liveSessionActive(session.status)) {
      await db.update(liveSessions).set({ lastHeartbeatAt: now, updatedAt: now }).where(eq(liveSessions.id, session.id));
    }
  }
  return { ok: true, browsePath: machine.browsePath };
}

async function jobFiles(db: Db, env: ServiceEnv, machineHost: string | null, items: Item[]) {
  const host = machineHost?.trim().toLowerCase() ?? '';
  const files = [];
  for (const item of items) {
    if (item.source === 'upload' && item.uploadId) {
      files.push({ id: item.id, source: 'upload', name: item.name, sha256: item.sha256 ?? null, uploadId: item.uploadId });
      continue;
    }
    if (item.source === 'library' && item.fileInstanceId) {
      const [file] = await db
        .select({ displayPath: fileInstances.displayPath, hostname: devices.hostname })
        .from(fileInstances)
        .innerJoin(devices, eq(devices.id, fileInstances.deviceId))
        .where(eq(fileInstances.id, item.fileInstanceId));
      if (host && file?.hostname && file.hostname.trim().toLowerCase() === host && file.displayPath) {
        files.push({ id: item.id, source: 'agent', name: item.name, path: file.displayPath, sha256: item.sha256 ?? null });
        continue;
      }
      const exp = Date.now() + 30 * 60_000;
      const media = signMediaToken(env.agentPairingSecret, { instanceId: item.fileInstanceId, userId: 'live-agent', exp });
      files.push({
        id: item.id,
        source: 'library',
        name: item.name,
        sha256: item.sha256 ?? null,
        url: `${env.appBaseUrl}/api/v1/files/${item.fileInstanceId}/stream?token=${encodeURIComponent(media)}`,
      });
      continue;
    }
    files.push({ id: item.id, source: 'agent', name: item.name, path: item.path });
  }
  return files;
}

const LIVE_FOLDER = 'C:\\MehakLive';

export async function agentJob(db: Db, env: ServiceEnv, token: string) {
  const machine = await machineFromToken(db, token);
  if (!machine) return null;
  const folder = machine.browsePath || machine.roots?.find(Boolean) || LIVE_FOLDER;
  if (!machine.currentSessionId) return { phase: 'idle' as const, browsePath: folder };
  const [session] = await db.select().from(liveSessions).where(eq(liveSessions.id, machine.currentSessionId));
  if (!session || !liveSessionActive(session.status)) return { phase: 'idle' as const, browsePath: folder };
  const settings = asSettings(session.settings);
  const base = {
    sessionId: session.id,
    browsePath: folder,
    files: await jobFiles(db, env, machine.hostname, asItems(session.playlistSnapshot)),
    loop: settings.loop !== false,
    resolution: settings.resolution ?? '1080p',
    prepareDeadline: new Date(session.jobCreatedAt.getTime() + PREPARE_LIMIT_MS).toISOString(),
  };
  if (session.status === 'STOPPING')
    return { ...base, phase: 'stop' as const, force: session.stopReason === 'EMERGENCY' };
  if (session.status === 'PREPARING') return { ...base, phase: 'prepare' as const };
  const secret = session.ingestSecret ? decryptJson<{ address: string; name: string }>(session.ingestSecret, env.encryptionKey) : null;
  const deadlines = [session.autoStopAt, session.ingestSafetyAt].filter((d): d is Date => d != null);
  return {
    ...base,
    phase: 'stream' as const,
    masterPath: typeof session.progress?.savedPath === 'string' ? session.progress.savedPath : 'C:\\MehakLive\\live.mp4',
    stopAt: deadlines.length ? new Date(Math.min(...deadlines.map((d) => d.getTime()))).toISOString() : null,
    ingest: secret ? { address: secret.address, name: secret.name } : null,
  };
}

export async function agentReport(
  db: Db,
  env: ServiceEnv,
  token: string,
  body: {
    sessionId: string;
    event: 'progress' | 'master_ready' | 'encoder_started' | 'encoder_stopped' | 'failed';
    progress?: Record<string, unknown>;
    items?: Item[];
    savedPath?: string;
    log?: string;
    error?: string;
    code?: string;
  },
  fetchImpl: FetchFn = fetch,
) {
  const machine = await machineFromToken(db, token);
  if (!machine || machine.currentSessionId !== body.sessionId) return null;
  const [row] = await db.select().from(liveSessions).where(and(eq(liveSessions.id, body.sessionId), eq(liveSessions.orgId, machine.orgId)));
  if (!row) return null;
  return applyLiveEvent(db, env, row, body, fetchImpl);
}

export async function applyLiveEvent(
  db: Db,
  env: ServiceEnv,
  row: typeof liveSessions.$inferSelect,
  body: {
    event: 'progress' | 'master_ready' | 'encoder_started' | 'encoder_stopped' | 'failed';
    progress?: Record<string, unknown>;
    items?: Item[];
    savedPath?: string;
    log?: string;
    error?: string;
    code?: string;
  },
  fetchImpl: FetchFn = fetch,
) {
  const now = new Date();
  const log = body.log ? redactStreamSecrets(body.log).slice(-4000) : row.logExcerpt;
  if (body.event === 'failed') {
    await db
      .update(liveSessions)
      .set({
        status: 'FAILED',
        stopReason: body.code === 'STORAGE' ? 'WORKER' : 'ENCODER',
        error: clean(body.error || 'The streaming computer stopped.'),
        logExcerpt: log,
        updatedAt: now,
      })
      .where(eq(liveSessions.id, row.id));
    await releaseMachine(db, row, now);
    return { ok: true };
  }
  if (body.event === 'master_ready') {
    if (row.status !== 'PREPARING' && row.status !== 'CREATING') return { ok: true };
    const items = asItems(row.playlistSnapshot).map((item) => {
      const next = (body.items ?? []).find((candidate) => candidate.id === item.id);
      return next ? { ...item, ...next, id: item.id, source: item.source, path: item.path } : item;
    });
    await db
      .update(liveSessions)
      .set({
        status: 'READY',
        playlistSnapshot: items,
        progress: {
          ...(row.progress ?? {}),
          masterReady: true,
          savedPath: body.savedPath?.slice(0, 500) ?? null,
        },
        logExcerpt: log,
        updatedAt: now,
      })
      .where(eq(liveSessions.id, row.id));
    return { ok: true };
  }
  if (body.event === 'encoder_started') {
    const safety = row.ingestSafetyAt ?? ingestionSafetyAt(now, row.policyStopMs);
    const manual = asSettings(row.settings).mode === 'manual';
    await db
      .update(liveSessions)
      .set({
        encoderStartedAt: row.encoderStartedAt ?? now,
        ingestSafetyAt: row.ingestSafetyAt ?? safety,
        lastHeartbeatAt: now,
        status: manual && row.status === 'CONNECTING' ? 'LIVE' : row.status,
        logExcerpt: log,
        updatedAt: now,
      })
      .where(eq(liveSessions.id, row.id));
    return { ok: true };
  }
  if (body.event === 'encoder_stopped') {
    await db
      .update(liveSessions)
      .set({
        encoderStoppedAt: row.encoderStoppedAt ?? now,
        status: row.status === 'FAILED' ? 'FAILED' : 'STOPPING',
        stopReason: row.stopReason ?? 'ENCODER',
        logExcerpt: log,
        updatedAt: now,
      })
      .where(eq(liveSessions.id, row.id));
    return { ok: true };
  }
  await db
    .update(liveSessions)
    .set({
      progress: { ...(row.progress ?? {}), ...(body.progress ?? {}) },
      lastHeartbeatAt: now,
      logExcerpt: log,
      updatedAt: now,
    })
    .where(eq(liveSessions.id, row.id));
  return { ok: true };
}

async function ensureBroadcast(db: Db, env: ServiceEnv, row: typeof liveSessions.$inferSelect, fetchImpl: FetchFn) {
  const settings = asSettings(row.settings);
  if (settings.mode === 'manual') {
    await db.update(liveSessions).set({ status: 'CONNECTING', updatedAt: new Date() }).where(eq(liveSessions.id, row.id));
    return;
  }
  if (row.youtubeBroadcastId && row.youtubeBound) {
    await db.update(liveSessions).set({ status: 'CONNECTING', updatedAt: new Date() }).where(eq(liveSessions.id, row.id));
    return;
  }
  const now = new Date();
  const [claimed] = await db
    .update(liveSessions)
    .set({ status: 'CREATING', updatedAt: now })
    .where(
      and(
        eq(liveSessions.id, row.id),
        sql`(${liveSessions.status} = 'READY' or (${liveSessions.status} = 'CREATING' and ${liveSessions.updatedAt} < ${new Date(now.getTime() - 2 * 60_000)}))`,
        sql`${liveSessions.youtubeBroadcastId} is null`,
      ),
    )
    .returning();
  if (!claimed) return;
  const ctx = {
    db,
    env,
    orgId: row.orgId,
    userId: row.userId,
    actor: { type: 'system' as const },
    now: () => new Date(),
  };
  let broadcastId: string | null = null;
  try {
    const { token } = await youtubeToken(ctx, row.socialAccountId!);
    const created = await createLiveBroadcast(fetchImpl, token, {
      title: row.title,
      description: settings.description ?? '',
      privacyStatus: settings.privacy ?? 'public',
      madeForKids: settings.madeForKids === true,
      scheduledStartTime: settings.scheduledStart ?? new Date().toISOString(),
      enableDvr: settings.enableDvr !== false,
      enableEmbed: settings.enableEmbed !== false,
      recordFromStart: settings.recordFromStart !== false,
      enableAutoStart: settings.enableAutoStart !== false,
      enableAutoStop: settings.enableAutoStop !== false,
      latencyPreference: settings.latency ?? 'normal',
      resolution: settings.resolution === '720p' ? '720p' : '1080p',
      closedCaptionsType: settings.captions === 'embedded' ? 'closedCaptionsEmbedded' : 'closedCaptionsDisabled',
    });
    broadcastId = created.broadcastId;
    const stream = await createIngestionStream(fetchImpl, token, row.title, settings.resolution === '720p' ? '720p' : '1080p');
    await bindLiveBroadcast(fetchImpl, token, created.broadcastId, stream.streamId);
    await db
      .update(liveSessions)
      .set({
        youtubeBroadcastId: created.broadcastId,
        youtubeStreamId: stream.streamId,
        youtubeBound: true,
        watchUrl: watchLink(created.broadcastId),
        ingestSecret: encryptJson({ address: stream.ingestionAddress, name: stream.streamName }, env.encryptionKey),
        status: 'CONNECTING',
        updatedAt: new Date(),
      })
      .where(eq(liveSessions.id, row.id));
    const notes: string[] = [];
    try {
      await updateLiveVideo(fetchImpl, token, created.broadcastId, {
        title: row.title,
        description: settings.description ?? '',
        tags: settings.tags,
        categoryId: settings.categoryId || '10',
        defaultLanguage: settings.language || 'en',
        privacyStatus: settings.privacy ?? 'public',
        selfDeclaredMadeForKids: settings.madeForKids === true,
        containsSyntheticMedia: settings.synthetic === true || settings.synthetic === false ? settings.synthetic : undefined,
        license: settings.license,
      });
    } catch (e) {
      notes.push(clean(e));
    }
    if (settings.ageRestricted) {
      try {
        await setLiveAgeRestriction(fetchImpl, token, created.broadcastId);
      } catch (e) {
        notes.push(clean(e));
      }
    }
    if (settings.paidPromotion === true || settings.paidPromotion === false) {
      try {
        await setLivePaidPromotion(fetchImpl, token, created.broadcastId, settings.paidPromotion);
      } catch (e) {
        notes.push(clean(e));
      }
    }
    if (settings.ads === 'on' || settings.ads === 'off') {
      try {
        await updateLiveMonetization(fetchImpl, token, created.broadcastId, settings.ads);
      } catch (e) {
        notes.push(clean(e));
      }
    }
    await db
      .update(liveSessions)
      .set(notes.length ? { error: notes.join(' ') } : { metadataApplied: true })
      .where(eq(liveSessions.id, row.id));
    if (settings.thumbnailFileId) {
      try {
        const exp = Date.now() + 5 * 60_000;
        const media = signMediaToken(env.agentPairingSecret, { instanceId: settings.thumbnailFileId, userId: 'live-thumb', exp });
        const res = await fetchImpl(`${env.appBaseUrl}/api/v1/files/${settings.thumbnailFileId}/stream?token=${encodeURIComponent(media)}`);
        if (!res.ok) throw new Error('The thumbnail could not be read from the library.');
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('YouTube thumbnails must be 2 MB or smaller. Set it in YouTube Studio.');
        await setLiveThumbnail(fetchImpl, token, created.broadcastId, bytes, res.headers.get('content-type') || 'image/jpeg');
      } catch (e) {
        await db.update(liveSessions).set({ error: clean(e) }).where(eq(liveSessions.id, row.id));
      }
    }
  } catch (e) {
    await db
      .update(liveSessions)
      .set({
        status: 'FAILED',
        stopReason: 'YOUTUBE',
        error: clean(e),
        youtubeBroadcastId: broadcastId,
        watchUrl: broadcastId ? watchLink(broadcastId) : null,
        updatedAt: new Date(),
      })
      .where(eq(liveSessions.id, row.id));
    await releaseMachine(db, row, new Date());
  }
}

async function tell(db: Db, row: typeof liveSessions.$inferSelect, type: string, title: string, body: string, dedupe: string) {
  await notify(db, {
    orgId: row.orgId,
    userId: row.userId,
    type,
    dedupeKey: dedupe,
    title,
    body,
    severity: type === 'live.replay' ? 'INFO' : 'WARNING',
    deepLink: '/comfy#live',
    sourceType: 'live_session',
    sourceId: row.id,
  });
}

export async function advanceLiveSessions(db: Db, env: ServiceEnv, now = new Date(), fetchImpl: FetchFn = fetch) {
  const rows = await db
    .select()
    .from(liveSessions)
    .where(
      sql`${liveSessions.status} in ('PREPARING','CREATING','CONNECTING','LIVE','INTERRUPTED','STOPPING')
        or (${liveSessions.nextVerifyAt} is not null and ${liveSessions.nextVerifyAt} <= ${now})`,
    )
    .limit(50);
  let moved = 0;
  for (const row of rows) {
    try {
      if (await advanceOne(db, env, row, now, fetchImpl)) moved++;
    } catch (e) {
      await db.update(liveSessions).set({ error: clean(e), updatedAt: now }).where(eq(liveSessions.id, row.id));
    }
  }
  return { checked: rows.length, moved };
}

async function advanceOne(db: Db, env: ServiceEnv, row: typeof liveSessions.$inferSelect, now: Date, fetchImpl: FetchFn) {
  if ((row.status === 'PREPARING' || row.status === 'CREATING') && now.getTime() - row.jobCreatedAt.getTime() > PREPARE_LIMIT_MS) {
    await db.update(liveSessions).set({ status: 'FAILED', stopReason: 'WORKER', error: 'Preparation took longer than 2 hours.', updatedAt: now }).where(eq(liveSessions.id, row.id));
    await releaseMachine(db, row, now);
    return true;
  }
  if (row.status === 'CREATING' && row.progress?.masterReady === true && !row.youtubeBroadcastId && !row.ingestSecret) {
    await ensureBroadcast(db, env, row, fetchImpl);
  }
  const [fresh] = await db.select().from(liveSessions).where(eq(liveSessions.id, row.id));
  if (!fresh) return false;
  if (notificationDue(now, fresh.notifyAt, fresh.notifiedAt)) {
    await tell(db, fresh, 'live.notice', 'Livestream time limit', notifyBody(fresh.policyNotifyMs, fresh.policyStopMs), `live.notice:${fresh.id}`);
    await db.update(liveSessions).set({ notifiedAt: now }).where(eq(liveSessions.id, fresh.id));
  }
  if (liveSessionActive(fresh.status) && fresh.status !== 'STOPPING' && stopDue(now, fresh.autoStopAt, fresh.ingestSafetyAt)) {
    fresh.status = 'STOPPING';
    fresh.stopReason = fresh.stopReason ?? 'AUTOMATIC';
    await db.update(liveSessions).set({ status: 'STOPPING', stopReason: fresh.stopReason, updatedAt: now }).where(eq(liveSessions.id, fresh.id));
  }
  if (fresh.status === 'LIVE' && fresh.lastHeartbeatAt && now.getTime() - fresh.lastHeartbeatAt.getTime() > env.agentOfflineAfterSeconds * 1000) {
    await db.update(liveSessions).set({ status: 'INTERRUPTED', updatedAt: now }).where(eq(liveSessions.id, fresh.id));
  }
  if (fresh.status === 'LIVE' && fresh.lastHeartbeatAt && now.getTime() - fresh.lastHeartbeatAt.getTime() <= 90_000) {
    const delta = fresh.verifiedAt ? Math.min(now.getTime() - fresh.verifiedAt.getTime(), 90_000) : 0;
    await db
      .update(liveSessions)
      .set({ verifiedLiveMs: fresh.verifiedLiveMs + Math.max(0, delta), verifiedAt: now })
      .where(eq(liveSessions.id, fresh.id));
  }
  const due = !fresh.youtubeCheckedAt || now.getTime() - fresh.youtubeCheckedAt.getTime() > 120_000;
  if (due && fresh.youtubeBroadcastId && asSettings(fresh.settings).mode !== 'manual' && ['CONNECTING', 'LIVE', 'INTERRUPTED', 'STOPPING'].includes(fresh.status))
    await observeYoutube(db, env, fresh, now, fetchImpl);
  const [after] = await db.select().from(liveSessions).where(eq(liveSessions.id, row.id));
  if (after?.status === 'STOPPING' && (after.encoderStoppedAt || (after.ingestSafetyAt && now >= after.ingestSafetyAt)))
    await finishBroadcast(db, env, after, now, fetchImpl);
  if (after && after.nextVerifyAt && after.nextVerifyAt <= now) await verifyReplay(db, env, after, now, fetchImpl);
  return true;
}

async function observeYoutube(db: Db, env: ServiceEnv, row: typeof liveSessions.$inferSelect, now: Date, fetchImpl: FetchFn) {
  const ctx = { db, env, orgId: row.orgId, userId: row.userId, actor: { type: 'system' as const }, now: () => new Date() };
  try {
    const { token } = await youtubeToken(ctx, row.socialAccountId!);
    const broadcast = await readLiveBroadcast(fetchImpl, token, row.youtubeBroadcastId!);
    const streamStatus = row.youtubeStreamId ? await readIngestion(fetchImpl, token, row.youtubeStreamId) : '';
    const patch: Partial<typeof liveSessions.$inferInsert> = { youtubeCheckedAt: now, updatedAt: now };
    if (streamStatus === 'active' && !row.firstIngestAt) patch.firstIngestAt = now;
    if (broadcast?.lifeCycleStatus === 'live' && row.status !== 'STOPPING') {
      patch.status = 'LIVE';
      if (broadcast.actualStartTime && !row.youtubeActualStartAt) {
        const start = new Date(broadcast.actualStartTime);
        patch.youtubeActualStartAt = start;
        if (row.policyNotifyMs != null)
          patch.notifyAt = tightenDeadline(row.notifyAt, new Date(start.getTime() + row.policyNotifyMs));
        patch.autoStopAt = tightenDeadline(row.autoStopAt, broadcastStopAt(start, row.policyStopMs, row.ingestSafetyAt));
      }
    } else if (broadcast && ['ready', 'testing', 'created'].includes(broadcast.lifeCycleStatus) && streamStatus === 'active') {
      const scheduled = asSettings(row.settings).scheduledStart ? new Date(asSettings(row.settings).scheduledStart!) : null;
      if (!scheduled || scheduled <= now) {
        try {
          await transitionLiveBroadcast(fetchImpl, token, row.youtubeBroadcastId!, 'live');
        } catch (e) {
          patch.error = clean(e);
        }
      }
    }
    await db.update(liveSessions).set(patch).where(eq(liveSessions.id, row.id));
  } catch (e) {
    await db.update(liveSessions).set({ youtubeCheckedAt: now, error: clean(e), updatedAt: now }).where(eq(liveSessions.id, row.id));
  }
}

async function finishBroadcast(db: Db, env: ServiceEnv, row: typeof liveSessions.$inferSelect, now: Date, fetchImpl: FetchFn) {
  const settings = asSettings(row.settings);
  if (settings.mode === 'manual') {
    await db
      .update(liveSessions)
      .set({
        status: 'ENDED',
        replayStatus: 'unverified',
        replayDetail: 'Manual mode does not complete a YouTube broadcast. End it in YouTube Studio if it is still open.',
        nextVerifyAt: null,
        updatedAt: now,
      })
      .where(eq(liveSessions.id, row.id));
    await releaseMachine(db, row, now);
    if (!row.endedNotifiedAt) {
      await tell(db, row, 'live.warning', 'Livestream ended', 'The encoder stopped. Manual mode cannot close the YouTube broadcast.', `live.ended:${row.id}`);
      await db.update(liveSessions).set({ endedNotifiedAt: now }).where(eq(liveSessions.id, row.id));
    }
    return;
  }
  if (!row.youtubeBroadcastId) {
    await db.update(liveSessions).set({ status: 'FAILED', stopReason: row.stopReason ?? 'YOUTUBE', error: row.error ?? 'YouTube never created a broadcast.', updatedAt: now }).where(eq(liveSessions.id, row.id));
    await releaseMachine(db, row, now);
    return;
  }
  const ctx = { db, env, orgId: row.orgId, userId: row.userId, actor: { type: 'system' as const }, now: () => new Date() };
  try {
    const { token } = await youtubeToken(ctx, row.socialAccountId!);
    let broadcast = await readLiveBroadcast(fetchImpl, token, row.youtubeBroadcastId);
    if (broadcast && broadcast.lifeCycleStatus !== 'complete' && broadcast.lifeCycleStatus !== 'revoked') {
      try {
        await transitionLiveBroadcast(fetchImpl, token, row.youtubeBroadcastId, 'complete');
      } catch (e) {
        const message = clean(e);
        broadcast = await readLiveBroadcast(fetchImpl, token, row.youtubeBroadcastId);
        if (!broadcast || (broadcast.lifeCycleStatus !== 'complete' && broadcast.lifeCycleStatus !== 'revoked')) {
          await db.update(liveSessions).set({ error: message, updatedAt: now }).where(eq(liveSessions.id, row.id));
          return;
        }
      }
      broadcast = await readLiveBroadcast(fetchImpl, token, row.youtubeBroadcastId);
    }
    await db
      .update(liveSessions)
      .set({
        status: 'ENDED',
        youtubeActualEndAt: broadcast?.actualEndTime ? new Date(broadcast.actualEndTime) : row.youtubeActualEndAt,
        replayStatus: 'pending',
        nextVerifyAt: new Date(now.getTime() + 20_000),
        updatedAt: now,
      })
      .where(eq(liveSessions.id, row.id));
    await releaseMachine(db, row, now);
    if (!row.endedNotifiedAt) {
      await tell(db, row, 'live.ended', 'Livestream ended', LIVE_ENDED_TEXT, `live.ended:${row.id}`);
      await db.update(liveSessions).set({ endedNotifiedAt: now }).where(eq(liveSessions.id, row.id));
    }
  } catch (e) {
    await db.update(liveSessions).set({ error: clean(e), updatedAt: now }).where(eq(liveSessions.id, row.id));
  }
}

async function verifyReplay(db: Db, env: ServiceEnv, row: typeof liveSessions.$inferSelect, now: Date, fetchImpl: FetchFn) {
  if (!row.youtubeBroadcastId || asSettings(row.settings).mode === 'manual') {
    await db.update(liveSessions).set({ nextVerifyAt: null }).where(eq(liveSessions.id, row.id));
    return;
  }
  const attempts = Number(row.progress?.replayAttempts ?? 0) + 1;
  const later = new Date(now.getTime() + Math.min(30 * 60_000, 60_000 * 2 ** Math.min(attempts, 5)));
  const ctx = { db, env, orgId: row.orgId, userId: row.userId, actor: { type: 'system' as const }, now: () => new Date() };
  try {
    const { token } = await youtubeToken(ctx, row.socialAccountId!);
    const video = await readLiveVideo(fetchImpl, token, row.youtubeBroadcastId);
    const intended = asSettings(row.settings).privacy ?? 'public';
    if (!video) {
      const missing = attempts >= 8;
      await db
        .update(liveSessions)
        .set({
          replayStatus: missing ? 'missing' : 'pending',
          replayDetail: missing ? 'YouTube has no replay for this broadcast. Kemokem will not upload the video again.' : 'YouTube has not published the replay yet.',
          nextVerifyAt: missing ? null : later,
          progress: { ...(row.progress ?? {}), replayAttempts: attempts },
        })
        .where(eq(liveSessions.id, row.id));
      if (missing && !row.replayNotifiedAt) {
        await tell(db, row, 'live.warning', 'Replay not available', 'YouTube has no replay for this livestream. It was not uploaded again.', `live.replay:${row.id}`);
        await db.update(liveSessions).set({ replayNotifiedAt: now }).where(eq(liveSessions.id, row.id));
      }
      return;
    }
    const failed = video.uploadStatus === 'failed' || video.uploadStatus === 'rejected' || video.processingStatus === 'failed';
    const processed = video.uploadStatus === 'processed' || video.processingStatus === 'succeeded';
    if (failed) {
      await db.update(liveSessions).set({ replayStatus: 'failed', replayDetail: `YouTube processing status: ${video.processingStatus || video.uploadStatus}.`, nextVerifyAt: null, progress: { ...(row.progress ?? {}), replayAttempts: attempts } }).where(eq(liveSessions.id, row.id));
      if (!row.replayNotifiedAt) {
        await tell(db, row, 'live.warning', 'Replay was not created', 'YouTube did not finish the replay. Kemokem did not upload a second copy.', `live.replay:${row.id}`);
        await db.update(liveSessions).set({ replayNotifiedAt: now }).where(eq(liveSessions.id, row.id));
      }
      return;
    }
    if (!processed) {
      await db.update(liveSessions).set({ replayStatus: 'processing', replayDetail: 'YouTube is still processing the replay.', nextVerifyAt: later, progress: { ...(row.progress ?? {}), replayAttempts: attempts } }).where(eq(liveSessions.id, row.id));
      return;
    }
    if (video.privacyStatus !== intended) {
      await db.update(liveSessions).set({ replayStatus: 'unverified', replayDetail: `The replay is ${video.privacyStatus}. Kemokem left that visibility as YouTube has it. The intended visibility was ${intended}.`, nextVerifyAt: null }).where(eq(liveSessions.id, row.id));
      if (!row.replayNotifiedAt) {
        await tell(db, row, 'live.warning', 'Replay visibility differs', `YouTube left this replay ${video.privacyStatus}. Kemokem did not change it.`, `live.replay:${row.id}`);
        await db.update(liveSessions).set({ replayNotifiedAt: now }).where(eq(liveSessions.id, row.id));
      }
      return;
    }
    const detail = video.title === row.title ? 'Title matches the livestream.' : 'The YouTube title differs from the title saved here.';
    await db.update(liveSessions).set({ replayStatus: video.privacyStatus, replayDetail: detail, nextVerifyAt: null, progress: { ...(row.progress ?? {}), replayAttempts: attempts } }).where(eq(liveSessions.id, row.id));
    if (!row.replayNotifiedAt) {
      const body = video.privacyStatus === 'public' ? `${LIVE_REPLAY_TEXT} ${row.watchUrl ?? ''}`.trim() : `Your livestream replay is ${video.privacyStatus} on YouTube. ${row.watchUrl ?? ''}`.trim();
      await tell(db, row, video.privacyStatus === 'public' ? 'live.replay' : 'live.warning', 'Livestream replay', body, `live.replay:${row.id}`);
      await db.update(liveSessions).set({ replayNotifiedAt: now }).where(eq(liveSessions.id, row.id));
    }
  } catch (e) {
    await db.update(liveSessions).set({ replayStatus: 'unverified', replayDetail: clean(e), nextVerifyAt: attempts >= 8 ? null : later, progress: { ...(row.progress ?? {}), replayAttempts: attempts } }).where(eq(liveSessions.id, row.id));
  }
}

export async function openLiveUpload(db: Db, env: ServiceEnv, token: string, uploadId: string) {
  const machine = await machineFromToken(db, token);
  if (!machine?.currentSessionId) return null;
  const [session] = await db.select().from(liveSessions).where(eq(liveSessions.id, machine.currentSessionId));
  if (!session) return null;
  const item = asItems(session.playlistSnapshot).find((entry) => entry.uploadId === uploadId);
  if (!item) return null;
  return { path: liveUploadPath(env, session.orgId, uploadId), sha256: item.sha256 ?? null, name: item.name };
}
