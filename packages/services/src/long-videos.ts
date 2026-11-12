import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  and,
  assetVersions,
  creativeProjects,
  distributionVariants,
  eq,
  generationJobs,
  gpuWorkers,
  logicalAssets,
  longVideoProjects,
  longVideoRefs,
  longVideoScenes,
  sql,
} from '@creatoros/db';
import { clipPlanCard, clipTitle, generationSeconds, h3AspectRatio, imageFileKey, isDefaultClipTitle, longVideoOutputFolder, orderByPlanName, parseClipPlan, planGenerationGroups, planScenes, resizeSceneSpan, spansFromClipSeconds, type SceneSpan } from '@creatoros/domain';
import { openAgentFile } from './agent-file';
import { notify } from './notifications';
import { badRequest, notFound, type Ctx, type ServiceEnv } from './types';

const AUDIO = new Set(['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg']);
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'webp']);

function extOf(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext.replace(/[^a-z0-9]/g, '').slice(0, 5);
}

function safeFile(root: string, rel: string) {
  const clean = rel.replace(/\\/g, '/');
  if (!clean.startsWith('long-videos/') || clean.includes('..')) throw badRequest('That file is not part of a long video.');
  const abs = path.resolve(root, clean);
  if (!abs.startsWith(path.resolve(root))) throw badRequest('That file is not part of a long video.');
  return abs;
}

function run(cmd: string, args: string[], out?: Buffer[]) {
  return new Promise<string>((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.stdout.on('data', (chunk: Buffer) => out?.push(chunk));
    child.on('error', (e: NodeJS.ErrnoException) => finish(e.code === 'ENOENT' ? `${cmd} is not installed.` : e.message));
    child.on('close', (code) => finish(code === 0 ? '' : err.trim().split('\n').pop() || `${cmd} failed`));
  });
}

async function probe(file: string) {
  const chunks: Buffer[] = [];
  const err = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], chunks);
  if (err) {
    throw badRequest(
      err.includes('not installed')
        ? 'The API server does not have ffprobe, so the song was not saved. FFmpeg on a PC is a different install. Rebuild the API image, then upload the song again.'
        : err,
    );
  }
  const body = JSON.parse(Buffer.concat(chunks).toString()) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; sample_rate?: string; channels?: number }[];
  };
  const audio = body.streams?.find((s) => s.codec_type === 'audio');
  const durationMs = Math.round(Number(body.format?.duration ?? 0) * 1000);
  if (!audio || !Number.isFinite(durationMs) || durationMs < 1000) {
    throw badRequest('That file has no playable audio, or it is shorter than one second.');
  }
  return { durationMs, sampleRate: Number(audio.sample_rate ?? 0) || null, channels: audio.channels ?? null };
}

async function peaksFor(file: string) {
  const chunks: Buffer[] = [];
  const err = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], chunks);
  if (err) return [];
  const pcm = Buffer.concat(chunks);
  const bars = 240;
  const samples = Math.floor(pcm.length / 2);
  const step = Math.max(1, Math.floor(samples / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    const from = i * step;
    for (let s = from; s < from + step && s < samples; s += 8) {
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(s * 2)));
    }
    peaks.push(Math.round((peak / 32767) * 100));
  }
  return peaks;
}

function clipLabel(label: string, position: number) {
  if (!label.trim() || isDefaultClipTitle(label)) return clipTitle(position);
  return label;
}

async function replaceScenes(ctx: Ctx, projectId: string, spans: SceneSpan[]) {
  const existing = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    const row = existing[i];
    if (row) {
      await ctx.db
        .update(longVideoScenes)
        .set({
          position: i + 1,
          startMs: span.startMs,
          endMs: span.endMs,
          label: clipLabel(row.label, i + 1),
          outdated: Boolean(row.takePath),
          updatedAt: new Date(),
        })
        .where(eq(longVideoScenes.id, row.id));
    } else {
      await ctx.db.insert(longVideoScenes).values({ projectId, position: i + 1, startMs: span.startMs, endMs: span.endMs, label: clipTitle(i + 1) });
    }
  }
  for (const extra of existing.slice(spans.length)) {
    await ctx.db.delete(longVideoScenes).where(eq(longVideoScenes.id, extra.id));
  }
}

export async function listLongVideos(ctx: Ctx) {
  return ctx.db
    .select()
    .from(longVideoProjects)
    .where(and(eq(longVideoProjects.orgId, ctx.orgId), sql`${longVideoProjects.archivedAt} is null`))
    .orderBy(sql`${longVideoProjects.updatedAt} desc`);
}

export async function createLongVideo(ctx: Ctx, input: { title: string; brandId?: string | null; aspect?: string }) {
  const title = input.title.trim();
  if (!title) throw badRequest('Name the project.');
  const [row] = await ctx.db
    .insert(longVideoProjects)
    .values({
      orgId: ctx.orgId,
      brandId: input.brandId ?? null,
      title: title.slice(0, 160),
      aspect: h3Aspect(input.aspect || '16:9'),
    })
    .returning();
  await ensureStudioProject(ctx, row!);
  return row!;
}

async function owned(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(longVideoProjects)
    .where(and(eq(longVideoProjects.id, id), eq(longVideoProjects.orgId, ctx.orgId), sql`${longVideoProjects.archivedAt} is null`))
    .limit(1);
  if (!row) throw notFound('Long video');
  return row;
}

export async function getLongVideo(ctx: Ctx, id: string) {
  const project = await owned(ctx, id);
  if (!project.creativeProjectId) {
    const linked = await ensureStudioProject(ctx, project);
    project.creativeProjectId = linked.creativeProjectId;
  }
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, id)).orderBy(longVideoScenes.position);
  const refs = await ctx.db.select().from(longVideoRefs).where(eq(longVideoRefs.projectId, id)).orderBy(longVideoRefs.createdAt, longVideoRefs.id);
  const workers = await ctx.db
    .select({ id: gpuWorkers.id, label: gpuWorkers.label, enabled: gpuWorkers.enabled })
    .from(gpuWorkers)
    .where(eq(gpuWorkers.orgId, ctx.orgId));
  return { project, scenes, refs, workers };
}

function h3Aspect(stored: string) {
  return h3AspectRatio(stored) ?? '16:9 (Widescreen)';
}

export async function updateLongVideo(
  ctx: Ctx,
  id: string,
  patch: {
    title?: string;
    aspect?: string;
    megapixels?: number;
    taskMode?: string;
    continuity?: string;
    refSize?: string;
    fps?: number;
    workerId?: string | null;
    targetSceneMs?: number;
  },
) {
  await owned(ctx, id);
  const [row] = await ctx.db
    .update(longVideoProjects)
    .set({
      ...(patch.title != null ? { title: patch.title.trim().slice(0, 160) } : {}),
      ...(patch.aspect && h3AspectRatio(patch.aspect) ? { aspect: h3AspectRatio(patch.aspect)! } : {}),
      ...(patch.megapixels === 0.5 || patch.megapixels === 1 || patch.megapixels === 1.5 ? { megapixels: patch.megapixels } : {}),
      ...(patch.taskMode === 'i2v' || patch.taskMode === 'ref' || patch.taskMode === 'v2v' || patch.taskMode === 'l2v' ? { taskMode: patch.taskMode } : {}),
      ...(patch.continuity === 'shot' || patch.continuity === 'context' || patch.continuity === 'context_swap' ? { continuity: patch.continuity } : {}),
      ...(patch.refSize === 'max' || patch.refSize === 'match' ? { refSize: patch.refSize } : {}),
      ...(patch.fps === 24 || patch.fps === 30 ? { fps: patch.fps } : {}),
      ...(patch.workerId !== undefined ? { workerId: patch.workerId } : {}),
      ...(patch.targetSceneMs != null ? { targetSceneMs: Math.min(15_000, Math.max(4_000, patch.targetSceneMs)) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(longVideoProjects.id, id))
    .returning();
  if (patch.title != null && row?.creativeProjectId) await syncStudioTitle(ctx, row.creativeProjectId, row.title);
  return row!;
}

/** One Production project and one Publishing row for this long video. Later renders join that same row. */
async function ensureStudioProject(
  ctx: Ctx,
  project: { id: string; title: string; brandId: string | null; creativeProjectId: string | null },
) {
  const folder = longVideoOutputFolder(project.title);
  const title = project.title.slice(0, 160);
  if (project.creativeProjectId) {
    const ids = await studioIds(ctx, project.creativeProjectId);
    if (ids.variantId && ids.assetId) {
      await attachExistingJobs(ctx, project.id, project.creativeProjectId, ids.variantId, ids.assetId, ids.assetVersionId, folder);
      return { creativeProjectId: project.creativeProjectId, folder, ...ids };
    }
  }
  const creativeProjectId = project.creativeProjectId ?? (await insertCreativeProject(ctx, project.brandId, title, folder));
  const [asset] = await ctx.db
    .insert(logicalAssets)
    .values({
      orgId: ctx.orgId,
      title,
      kind: 'VIDEO',
      brandId: project.brandId,
      projectId: creativeProjectId,
      source: 'comfyui-h3',
      creativeState: 'DRAFT',
    })
    .returning({ id: logicalAssets.id });
  const [version] = await ctx.db
    .insert(assetVersions)
    .values({
      orgId: ctx.orgId,
      assetId: asset!.id,
      label: 'MiniMax',
      number: 1,
      variantType: 'LYRIC_VIDEO',
      isMaster: true,
      approvalState: 'PENDING',
    })
    .returning({ id: assetVersions.id });
  const [variant] = await ctx.db
    .insert(distributionVariants)
    .values({
      orgId: ctx.orgId,
      assetId: asset!.id,
      assetVersionId: version!.id,
      projectId: creativeProjectId,
      brandId: project.brandId,
      format: 'LYRIC_VIDEO',
      titleMaster: title,
      readiness: 'DRAFT',
    })
    .returning({ id: distributionVariants.id });
  await ctx.db.update(logicalAssets).set({ selectedVersionId: version!.id }).where(eq(logicalAssets.id, asset!.id));
  if (!project.creativeProjectId) {
    await ctx.db.update(longVideoProjects).set({ creativeProjectId }).where(eq(longVideoProjects.id, project.id));
  }
  await attachExistingJobs(ctx, project.id, creativeProjectId, variant!.id, asset!.id, version!.id, folder);
  return { creativeProjectId, folder, variantId: variant!.id, assetId: asset!.id, assetVersionId: version!.id };
}

async function attachExistingJobs(
  ctx: Ctx,
  longVideoId: string,
  creativeProjectId: string,
  variantId: string,
  assetId: string,
  assetVersionId: string | null,
  folder: string,
) {
  const link = JSON.stringify({ variantId, assetId, assetVersionId });
  await ctx.db.execute(sql`
    update generation_jobs
    set project_id = ${creativeProjectId}::uuid,
        settings = settings || ${link}::jsonb,
        updated_at = now()
    where org_id = ${ctx.orgId}
      and project_id is null
      and settings->>'longVideoProjectId' = ${longVideoId}`);
  await ctx.db.execute(sql`
    update generation_jobs
    set settings = jsonb_set(settings, '{projectName}', to_jsonb(${folder}::text), true),
        updated_at = now()
    where org_id = ${ctx.orgId}
      and status = 'QUEUED'
      and coalesce(settings->>'projectName', '') = ''
      and settings->>'longVideoProjectId' = ${longVideoId}`);
}

async function insertCreativeProject(ctx: Ctx, brandId: string | null, title: string, folder: string) {
  const [created] = await ctx.db
    .insert(creativeProjects)
    .values({
      orgId: ctx.orgId,
      brandId,
      type: 'MUSIC_VIDEO',
      contentFormat: 'LYRIC_VIDEO',
      title,
      stage: 'IN_PROGRESS',
      ownerUserId: ctx.userId,
      brief: `Long video. The PC that renders it saves the files in easy_media/projects/${folder}.`,
    })
    .returning({ id: creativeProjects.id });
  return created!.id;
}

async function studioIds(ctx: Ctx, creativeProjectId: string) {
  const [row] = await ctx.db
    .select({
      variantId: distributionVariants.id,
      assetId: distributionVariants.assetId,
      assetVersionId: distributionVariants.assetVersionId,
    })
    .from(distributionVariants)
    .where(and(eq(distributionVariants.projectId, creativeProjectId), eq(distributionVariants.orgId, ctx.orgId)))
    .limit(1);
  return { variantId: row?.variantId ?? null, assetId: row?.assetId ?? null, assetVersionId: row?.assetVersionId ?? null };
}

async function syncStudioTitle(ctx: Ctx, creativeProjectId: string, title: string) {
  const next = title.slice(0, 160);
  await ctx.db.update(creativeProjects).set({ title: next, updatedAt: new Date() }).where(eq(creativeProjects.id, creativeProjectId));
  await ctx.db
    .update(logicalAssets)
    .set({ title: next, updatedAt: new Date() })
    .where(and(eq(logicalAssets.projectId, creativeProjectId), eq(logicalAssets.orgId, ctx.orgId)));
  await ctx.db
    .update(distributionVariants)
    .set({ titleMaster: next, updatedAt: new Date() })
    .where(and(eq(distributionVariants.projectId, creativeProjectId), eq(distributionVariants.orgId, ctx.orgId)));
}

export async function saveLongVideoAudio(ctx: Ctx, id: string, file: { bytes: Buffer; name: string }) {
  const project = await owned(ctx, id);
  const ext = extOf(file.name);
  if (!AUDIO.has(ext)) throw badRequest('Use an mp3, wav, m4a, flac, aac, or ogg song.');
  if (file.bytes.length > 80 * 1024 * 1024) throw badRequest('The song is over 80 MB.');
  const rel = `long-videos/${id}/audio.${ext}`;
  const abs = safeFile(ctx.env.attachmentsDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, file.bytes);
  const meta = await probe(abs);
  const peaks = await peaksFor(abs);
  await ctx.db
    .update(longVideoProjects)
    .set({
      audioPath: rel,
      audioName: file.name.slice(0, 200),
      audioMime: ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : 'audio/mp4',
      durationMs: meta.durationMs,
      sampleRate: meta.sampleRate,
      channels: meta.channels,
      peaks,
      comfyAudioName: null,
      status: 'READY',
      updatedAt: new Date(),
    })
    .where(eq(longVideoProjects.id, id));
  await replaceScenes(ctx, id, planScenes(meta.durationMs, project.targetSceneMs));
  return getLongVideo(ctx, id);
}

export async function rebalanceLongVideo(ctx: Ctx, id: string, seconds?: number) {
  const project = await owned(ctx, id);
  if (!project.durationMs) {
    throw badRequest('This project has no song length yet. The upload did not finish, so choose the song again. Rebuild only splits a song that already has a length.');
  }
  const busy = await ctx.db
    .select({ id: longVideoScenes.id })
    .from(longVideoScenes)
    .where(and(eq(longVideoScenes.projectId, id), sql`${longVideoScenes.status} in ('QUEUED', 'RUNNING')`))
    .limit(1);
  if (busy.length) throw badRequest('Stop the section that is still generating before rebuilding.');
  const targetMs = seconds == null ? project.targetSceneMs : Math.min(15_000, Math.max(4_000, Math.round(seconds * 1000)));
  if (targetMs !== project.targetSceneMs) {
    await ctx.db.update(longVideoProjects).set({ targetSceneMs: targetMs, updatedAt: new Date() }).where(eq(longVideoProjects.id, id));
  }
  await replaceScenes(ctx, id, planScenes(project.durationMs, targetMs));
  return getLongVideo(ctx, id);
}

export async function updateLongVideoScene(
  ctx: Ctx,
  projectId: string,
  sceneId: string,
  patch: { label?: string; prompt?: string; mode?: string; durationSec?: number; continuity?: string; workerId?: string | null },
) {
  await owned(ctx, projectId);
  if (patch.durationSec != null) await resizeLongVideoScene(ctx, projectId, sceneId, patch.durationSec);
  if (patch.workerId) {
    const [worker] = await ctx.db
      .select({ id: gpuWorkers.id })
      .from(gpuWorkers)
      .where(and(eq(gpuWorkers.id, patch.workerId), eq(gpuWorkers.orgId, ctx.orgId)))
      .limit(1);
    if (!worker) throw badRequest('That PC is no longer in Settings.');
  }
  const [row] = await ctx.db
    .update(longVideoScenes)
    .set({
      ...(patch.label != null ? { label: patch.label.slice(0, 80) } : {}),
      ...(patch.prompt != null ? { prompt: patch.prompt } : {}),
      ...(patch.mode === 'vocal' || patch.mode === 'broll' ? { mode: patch.mode } : {}),
      ...(patch.continuity === 'shot' || patch.continuity === 'context' ? { continuity: patch.continuity } : {}),
      ...(patch.workerId !== undefined ? { workerId: patch.workerId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(longVideoScenes.id, sceneId), eq(longVideoScenes.projectId, projectId)))
    .returning();
  if (!row) throw notFound('Scene');
  if (patch.prompt != null && row.jobId && row.status === 'QUEUED') await rewriteQueuedPrompt(ctx, row.jobId, sceneId, row.prompt);
  return row;
}

async function rewriteQueuedPrompt(ctx: Ctx, jobId: string, sceneId: string, prompt: string) {
  const [job] = await ctx.db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.orgId, ctx.orgId), eq(generationJobs.status, 'QUEUED')))
    .limit(1);
  if (!job) return;
  const settings = job.settings as { longVideoSceneIds?: string[]; segments?: { prompt?: string }[]; prompt?: string };
  const index = settings.longVideoSceneIds?.indexOf(sceneId) ?? -1;
  const segment = index >= 0 ? settings.segments?.[index] : undefined;
  if (!segment) return;
  segment.prompt = prompt;
  settings.prompt = (settings.segments ?? []).map((item) => item.prompt?.trim() ?? '').filter(Boolean).join('\n');
  await ctx.db
    .update(generationJobs)
    .set({ settings, updatedAt: new Date() })
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'QUEUED')));
}

/** A shorter scene gives the spare song to the next one. A longer scene takes that song from the next one. The last scene trades with the one before it. */
async function resizeLongVideoScene(ctx: Ctx, projectId: string, sceneId: string, durationSec: number) {
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  const index = scenes.findIndex((s) => s.id === sceneId);
  if (index < 0) throw notFound('Scene');
  const scene = scenes[index]!;
  if (scene.status === 'QUEUED' || scene.status === 'RUNNING') throw badRequest('Wait until this scene finishes before changing its length.');
  const moved = resizeSceneSpan(
    scenes.map((item) => ({ startMs: item.startMs, endMs: item.endMs })),
    index,
    durationSec * 1000,
  );
  if ('error' in moved) throw badRequest(moved.error);
  for (const [sceneIndex, span] of moved.spans.entries()) {
    const row = scenes[sceneIndex]!;
    if (row.startMs === span.startMs && row.endMs === span.endMs) continue;
    await ctx.db
      .update(longVideoScenes)
      .set({ startMs: span.startMs, endMs: span.endMs, outdated: Boolean(row.takePath), updatedAt: new Date() })
      .where(eq(longVideoScenes.id, row.id));
  }
  await syncQueuedSong(ctx, projectId);
}

async function syncQueuedSong(ctx: Ctx, projectId: string) {
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId));
  const jobIds = [...new Set(scenes.map((scene) => scene.jobId).filter((id): id is string => !!id))];
  for (const jobId of jobIds) {
    const [job] = await ctx.db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.id, jobId), eq(generationJobs.orgId, ctx.orgId), eq(generationJobs.status, 'QUEUED')))
      .limit(1);
    if (!job) continue;
    const settings = job.settings as {
      longVideoSceneIds?: string[];
      segments?: { audioStartSec?: number; audioUseSec?: number; durationSec?: number }[];
    };
    let changed = false;
    for (const [segmentIndex, sceneId] of (settings.longVideoSceneIds ?? []).entries()) {
      const scene = scenes.find((item) => item.id === sceneId);
      const segment = settings.segments?.[segmentIndex];
      if (!scene || !segment) continue;
      segment.audioStartSec = scene.startMs / 1000;
      segment.audioUseSec = (scene.endMs - scene.startMs) / 1000;
      segment.durationSec = generationSeconds(scene.endMs - scene.startMs).requestSec;
      changed = true;
    }
    if (!changed) continue;
    await ctx.db.update(generationJobs).set({ settings, updatedAt: new Date() }).where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'QUEUED')));
  }
}

export async function splitLongVideoScene(ctx: Ctx, projectId: string, sceneId: string) {
  await owned(ctx, projectId);
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) throw notFound('Scene');
  const mid = scene.startMs + Math.floor((scene.endMs - scene.startMs) / 2);
  if (mid - scene.startMs < 1000 || scene.endMs - mid < 1000) throw badRequest('That scene is too short to split.');
  await ctx.db.update(longVideoScenes).set({ endMs: mid, outdated: Boolean(scene.takePath), updatedAt: new Date() }).where(eq(longVideoScenes.id, scene.id));
  await ctx.db.insert(longVideoScenes).values({
    projectId,
    position: scene.position + 1,
    startMs: mid,
    endMs: scene.endMs,
    label: clipTitle(scene.position + 1),
    mode: scene.mode,
    prompt: scene.prompt,
  });
  for (const later of scenes.filter((s) => s.position > scene.position)) {
    const position = later.position + 1;
    await ctx.db.update(longVideoScenes).set({ position, label: clipLabel(later.label, position) }).where(eq(longVideoScenes.id, later.id));
  }
  return getLongVideo(ctx, projectId);
}

export async function deleteLongVideoScene(ctx: Ctx, projectId: string, sceneId: string) {
  await owned(ctx, projectId);
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  if (scenes.length < 2) throw badRequest('The song needs at least one scene.');
  const index = scenes.findIndex((s) => s.id === sceneId);
  if (index < 0) throw notFound('Scene');
  const scene = scenes[index]!;
  const neighbor = scenes[index + 1] ?? scenes[index - 1]!;
  await ctx.db
    .update(longVideoScenes)
    .set({
      startMs: Math.min(neighbor.startMs, scene.startMs),
      endMs: Math.max(neighbor.endMs, scene.endMs),
      outdated: Boolean(neighbor.takePath),
      updatedAt: new Date(),
    })
    .where(eq(longVideoScenes.id, neighbor.id));
  await ctx.db.delete(longVideoScenes).where(eq(longVideoScenes.id, scene.id));
  const left = scenes.filter((s) => s.id !== scene.id);
  for (let i = 0; i < left.length; i++) {
    const position = i + 1;
    await ctx.db.update(longVideoScenes).set({ position, label: clipLabel(left[i]!.label, position) }).where(eq(longVideoScenes.id, left[i]!.id));
  }
  return getLongVideo(ctx, projectId);
}

async function bytesOf(body: ReadableStream<Uint8Array>, max: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > max) throw badRequest('That library file is too large to copy into this project.');
    chunks.push(next.value);
  }
  return Buffer.concat(chunks);
}

export async function addLongVideoFromLibrary(ctx: Ctx, projectId: string, fileId: string, sceneId: string | null) {
  await owned(ctx, projectId);
  const opened = await openAgentFile(ctx.db, ctx.env, ctx.orgId, fileId);
  const ext = extOf(opened.name);
  const audio = AUDIO.has(ext) || opened.mime.startsWith('audio');
  const bytes = await bytesOf(opened.body, audio ? 80 * 1024 * 1024 : 20 * 1024 * 1024);
  if (audio) {
    if (sceneId) throw badRequest('A song from the library replaces the project song. Pick it from the song row.');
    return saveLongVideoAudio(ctx, projectId, { bytes, name: opened.name });
  }
  if (!IMAGE.has(ext) && !opened.mime.startsWith('image')) throw badRequest('Choose an image or a song from the library.');
  return addLongVideoRef(ctx, projectId, sceneId, { bytes, name: opened.name });
}

export async function addLongVideoRef(ctx: Ctx, projectId: string, sceneId: string | null, file: { bytes: Buffer; name: string }) {
  await owned(ctx, projectId);
  const ext = extOf(file.name);
  if (!IMAGE.has(ext)) throw badRequest('Use a jpg, png, or webp picture.');
  if (file.bytes.length > 20 * 1024 * 1024) throw badRequest('That picture is over 20 MB.');
  const [ref] = await ctx.db
    .insert(longVideoRefs)
    .values({ projectId, sceneId, name: file.name.slice(0, 160), path: 'pending' })
    .returning();
  const rel = `long-videos/${projectId}/refs/${ref!.id}.${ext}`;
  const abs = safeFile(ctx.env.attachmentsDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, file.bytes);
  await ctx.db.update(longVideoRefs).set({ path: rel }).where(eq(longVideoRefs.id, ref!.id));
  return { ...ref!, path: rel };
}

export async function importLongVideoPlan(ctx: Ctx, projectId: string, jsonText: string, files: { name: string; bytes: Buffer }[]) {
  const project = await owned(ctx, projectId);
  if (!project.durationMs) throw badRequest('Upload the song before applying a clip plan.');
  let value: unknown;
  try {
    value = JSON.parse(jsonText.replace(/^\uFEFF/, ''));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid JSON';
    throw badRequest(`That file is not valid JSON. ${message}`);
  }
  const parsed = parseClipPlan(value);
  if ('error' in parsed) throw badRequest(parsed.error);
  const laid = spansFromClipSeconds(project.durationMs, parsed.plan.clips.map((clip) => clip.durationSec));
  if ('error' in laid) throw badRequest(laid.error);
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  if (scenes.some((scene) => scene.status === 'QUEUED' || scene.status === 'RUNNING')) throw badRequest('Wait until the current render finishes before applying a clip plan.');

  if (files.length > 40) throw badRequest('Upload at most 40 pictures with a clip plan.');
  const byKey = new Map<string, { name: string; bytes: Buffer }>();
  for (const file of files) {
    const key = imageFileKey(file.name || '');
    if (!key) throw badRequest('One of the pictures has no file name.');
    if (byKey.has(key)) throw badRequest(`Two pictures are named ${file.name}. Keep one.`);
    const ext = extOf(file.name);
    if (!IMAGE.has(ext)) throw badRequest(`${file.name} needs to be a jpg, png, or webp.`);
    if (file.bytes.length > 20 * 1024 * 1024) throw badRequest(`${file.name} is over 20 MB.`);
    byKey.set(key, file);
  }
  const neededNames: string[] = [];
  const needed = new Set<string>();
  for (const clip of parsed.plan.clips) {
    for (const name of clip.images) {
      const key = imageFileKey(name);
      if (needed.has(key)) continue;
      needed.add(key);
      neededNames.push(name);
    }
  }
  const missing = neededNames.filter((name) => !byKey.has(imageFileKey(name)));
  if (missing.length) throw badRequest(`These pictures are named in the plan and were not uploaded: ${missing.join(', ')}`);
  const unusedImages = [...byKey.entries()].filter(([key]) => !needed.has(key)).map(([, file]) => file.name);
  const workers = await ctx.db
    .select({ id: gpuWorkers.id, label: gpuWorkers.label, enabled: gpuWorkers.enabled })
    .from(gpuWorkers)
    .where(eq(gpuWorkers.orgId, ctx.orgId));
  const cardId = (card: '3060' | '3090') => {
    const hits = workers.filter((worker) => new RegExp(`\\b${card}\\b`).test(worker.label));
    const chosen = hits.find((worker) => worker.enabled) ?? hits[0];
    if (!chosen) throw badRequest(`Add the ${card} before applying a clip plan.`);
    return chosen.id;
  };
  const gpu3090 = cardId('3090');
  const needs3060 = laid.spans.some((span) => clipPlanCard(span.endMs - span.startMs) === '3060');
  const gpu3060 = needs3060 ? cardId('3060') : null;
  await ctx.db.update(longVideoProjects).set({ workerId: gpu3090, updatedAt: new Date() }).where(eq(longVideoProjects.id, projectId));
  let shortSceneCount = 0;
  const globalKeys = new Set(parsed.plan.globalImages.map((name) => imageFileKey(name)));
  const oldRefs = await ctx.db.select().from(longVideoRefs).where(eq(longVideoRefs.projectId, projectId));
  for (const ref of oldRefs) await removeLongVideoRef(ctx, projectId, ref.id);

  for (let i = 0; i < parsed.plan.clips.length; i++) {
    const clip = parsed.plan.clips[i]!;
    const span = laid.spans[i]!;
    const row = scenes[i];
    const short = clipPlanCard(span.endMs - span.startMs) === '3060';
    if (short) shortSceneCount += 1;
    const values = {
      position: i + 1,
      startMs: span.startMs,
      endMs: span.endMs,
      label: clip.name,
      mode: clip.vocal ? 'vocal' : 'broll',
      prompt: clip.prompt,
      songNotes: clip.songDetails,
      imageNotes: clip.imageDetails,
      imageOrder: clip.images,
      workerId: short ? gpu3060 : null,
      outdated: Boolean(row?.takePath),
      error: null as string | null,
      updatedAt: new Date(),
    };
    if (row) await ctx.db.update(longVideoScenes).set(values).where(eq(longVideoScenes.id, row.id));
    else await ctx.db.insert(longVideoScenes).values({ projectId, ...values });
  }
  for (const extra of scenes.slice(parsed.plan.clips.length)) {
    await ctx.db.delete(longVideoScenes).where(eq(longVideoScenes.id, extra.id));
  }
  const written = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  for (const name of parsed.plan.globalImages) {
    const file = byKey.get(imageFileKey(name));
    if (file) await addLongVideoRef(ctx, projectId, null, file);
  }
  for (let i = 0; i < parsed.plan.clips.length; i++) {
    const scene = written[i];
    if (!scene) continue;
    for (const name of parsed.plan.clips[i]!.images) {
      if (globalKeys.has(imageFileKey(name))) continue;
      const file = byKey.get(imageFileKey(name));
      if (file) await addLongVideoRef(ctx, projectId, scene.id, file);
    }
  }
  return {
    sceneCount: parsed.plan.clips.length,
    globalImages: parsed.plan.globalImages,
    songDifferenceMs: laid.songDifferenceMs,
    shortSceneCount,
    unusedImages,
  };
}

export async function removeLongVideoRef(ctx: Ctx, projectId: string, refId: string) {
  await owned(ctx, projectId);
  const [ref] = await ctx.db
    .select()
    .from(longVideoRefs)
    .where(and(eq(longVideoRefs.id, refId), eq(longVideoRefs.projectId, projectId)))
    .limit(1);
  if (!ref) return;
  await ctx.db.delete(longVideoRefs).where(eq(longVideoRefs.id, ref.id));
  if (ref.path.startsWith('long-videos/')) await rm(safeFile(ctx.env.attachmentsDir, ref.path), { force: true });
}

async function stopComfyPrompt(baseUrl: string, promptId: string) {
  await fetch(new URL('/queue', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
  try {
    const res = await fetch(new URL('/queue', baseUrl), { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return;
    const body = (await res.json()) as { queue_running?: unknown };
    if (!JSON.stringify(body.queue_running ?? []).includes(promptId)) return;
    await fetch(new URL('/interrupt', baseUrl), { method: 'POST', signal: AbortSignal.timeout(8_000) });
  } catch {
    /* The record is cancelled even when that PC cannot be reached. */
  }
}

async function cancelGeneration(ctx: Ctx, jobId: string) {
  const [job] = await ctx.db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.orgId, ctx.orgId)))
    .limit(1);
  if (!job || (job.status !== 'QUEUED' && job.status !== 'RUNNING')) return;
  const workerId = (job.settings as { workerId?: string }).workerId;
  if (job.promptId && workerId) {
    const [worker] = await ctx.db
      .select({ baseUrl: gpuWorkers.baseUrl })
      .from(gpuWorkers)
      .where(and(eq(gpuWorkers.id, workerId), eq(gpuWorkers.orgId, ctx.orgId)))
      .limit(1);
    if (worker) await stopComfyPrompt(worker.baseUrl, job.promptId);
  }
  await ctx.db
    .update(generationJobs)
    .set({ status: 'CANCELLED', error: 'Stopped from Long Videos.', finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(generationJobs.id, jobId), sql`${generationJobs.status} in ('QUEUED', 'RUNNING')`));
  await ctx.db.execute(sql`
    update long_video_scenes
    set status = case when take_path is not null then 'READY' else 'DRAFT' end,
        job_id = null, error = null, updated_at = now()
    where job_id = ${jobId}::uuid and status in ('QUEUED', 'RUNNING')`);
}

export async function cancelLongVideoScene(ctx: Ctx, projectId: string, sceneId: string) {
  await owned(ctx, projectId);
  const [scene] = await ctx.db
    .select()
    .from(longVideoScenes)
    .where(and(eq(longVideoScenes.id, sceneId), eq(longVideoScenes.projectId, projectId)))
    .limit(1);
  if (!scene) throw notFound('Scene');
  if (scene.status !== 'QUEUED' && scene.status !== 'RUNNING') throw badRequest('This section is not generating.');
  if (scene.jobId) await cancelGeneration(ctx, scene.jobId);
  else {
    await ctx.db
      .update(longVideoScenes)
      .set({ status: scene.takePath ? 'READY' : 'DRAFT', error: null, updatedAt: new Date() })
      .where(eq(longVideoScenes.id, scene.id));
  }
  await ctx.db.update(longVideoProjects).set({ batchState: 'pause', updatedAt: new Date() }).where(eq(longVideoProjects.id, projectId));
  return getLongVideo(ctx, projectId);
}

export async function deleteLongVideo(ctx: Ctx, projectId: string) {
  const data = await getLongVideo(ctx, projectId);
  const jobIds = [...new Set(data.scenes.filter((scene) => scene.jobId && (scene.status === 'QUEUED' || scene.status === 'RUNNING')).map((scene) => scene.jobId!))];
  for (const jobId of jobIds) await cancelGeneration(ctx, jobId);
  await ctx.db
    .update(longVideoProjects)
    .set({ archivedAt: new Date(), batchState: 'off', updatedAt: new Date() })
    .where(eq(longVideoProjects.id, projectId));
  return { ok: true as const };
}

export async function openLongVideoFile(ctx: Ctx, projectId: string, kind: 'audio' | 'export' | 'ref' | 'take' | 'prior-take', refId?: string) {
  const project = await owned(ctx, projectId);
  const rel = kind === 'audio' ? project.audioPath : kind === 'export' ? project.exportPath : null;
  if (kind === 'take' || kind === 'prior-take') {
    const [scene] = await ctx.db
      .select()
      .from(longVideoScenes)
      .where(and(eq(longVideoScenes.id, refId ?? ''), eq(longVideoScenes.projectId, projectId)))
      .limit(1);
    const stored = kind === 'prior-take' ? scene?.priorTakePath : scene?.takePath;
    if (!scene || !stored?.startsWith('long-videos/')) throw notFound('Video');
    return { abs: safeFile(ctx.env.attachmentsDir, stored), name: `scene-${scene.position}.mp4` };
  }
  if (kind === 'ref') {
    const [ref] = await ctx.db
      .select()
      .from(longVideoRefs)
      .where(and(eq(longVideoRefs.id, refId ?? ''), eq(longVideoRefs.projectId, projectId)))
      .limit(1);
    if (!ref) throw notFound('Picture');
    return { abs: safeFile(ctx.env.attachmentsDir, ref.path), name: ref.name };
  }
  if (!rel) throw notFound('File');
  return { abs: safeFile(ctx.env.attachmentsDir, rel), name: kind === 'audio' ? project.audioName || 'song' : `${project.title}.mp4` };
}

export function sectionClipName(position: number, label: string) {
  const clean = (label.trim() || `scene-${String(position).padStart(2, '0')}`).replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${String(position).padStart(2, '0')}-${clean || 'scene'}.mp4`;
}

/** One file per section that already has a video. A local take is preferred. Otherwise the file is still on the PC that rendered it. */
export async function longVideoClipParts(ctx: Ctx, projectId: string) {
  const data = await getLongVideo(ctx, projectId);
  const parts: { name: string; abs?: string; jobId?: string }[] = [];
  for (const scene of data.scenes) {
    const name = sectionClipName(scene.position, scene.label);
    const jobId = scene.shownJobId ?? (scene.status === 'READY' ? scene.jobId : null);
    if (scene.takePath?.startsWith('long-videos/')) {
      parts.push({ name, abs: safeFile(ctx.env.attachmentsDir, scene.takePath), jobId: jobId ?? undefined });
      continue;
    }
    if (jobId) parts.push({ name, jobId });
  }
  if (!parts.length) throw badRequest('No section has a video yet.');
  return { title: data.project.title, parts };
}

async function uploadToWorker(origin: string, file: { bytes: Buffer; name: string; mime: string }) {
  const form = new FormData();
  form.append('image', new Blob([Uint8Array.from(file.bytes)], { type: file.mime }), file.name);
  form.append('overwrite', 'true');
  form.append('type', 'input');
  const res = await fetch(new URL('/upload/image', origin), { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw badRequest(`The PC refused the file (${res.status}).`);
  const body = (await res.json()) as { name?: string; subfolder?: string };
  if (!body.name) throw badRequest('The PC did not accept the file.');
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

export async function queueLongVideoScene(ctx: Ctx, projectId: string, sceneId: string) {
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  const groups = planGenerationGroups(
    scenes.map((scene) => ({ id: scene.id, continuity: scene.continuity === 'context' ? 'context' : 'shot', status: scene.status })),
    'one',
    sceneId,
  );
  const group = groups[0];
  if (!group?.length) throw badRequest('That scene, or the one before it, is already generating.');
  return queueLongVideoGroup(ctx, projectId, group, sceneId);
}

export async function queueNextLongVideoGroup(ctx: Ctx, projectId: string) {
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  const groups = planGenerationGroups(
    scenes.map((scene) => ({ id: scene.id, continuity: scene.continuity === 'context' ? 'context' : 'shot', status: scene.status })),
    'all',
  );
  const group = groups[0];
  if (!group?.length) return null;
  await queueLongVideoGroup(ctx, projectId, group);
  return group;
}

async function queueLongVideoGroup(ctx: Ctx, projectId: string, sceneIds: string[], preferredSceneId?: string) {
  const project = await owned(ctx, projectId);
  if (!project.audioPath || !project.durationMs) throw badRequest('Upload the song first.');
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  const chosen = sceneIds.map((id) => scenes.find((scene) => scene.id === id)).filter((scene) => !!scene);
  if (chosen.length !== sceneIds.length) throw notFound('Scene');
  if (chosen.some((scene) => scene.status === 'QUEUED' || scene.status === 'RUNNING')) throw badRequest('One of these scenes is already generating.');
  const lead = chosen.find((scene) => scene.id === preferredSceneId) ?? chosen[0]!;
  const workerId = lead.workerId ?? project.workerId;
  if (!workerId) throw badRequest('Choose the PC for this section, or the PC at the top of the project.');
  const [worker] = await ctx.db
    .select()
    .from(gpuWorkers)
    .where(and(eq(gpuWorkers.id, workerId), eq(gpuWorkers.orgId, ctx.orgId)))
    .limit(1);
  if (!worker) throw badRequest('That PC is no longer in Settings.');
  const refs = await ctx.db.select().from(longVideoRefs).where(eq(longVideoRefs.projectId, projectId)).orderBy(longVideoRefs.createdAt, longVideoRefs.id);
  let audioName = project.comfyAudioName;
  if (!audioName || project.comfyAudioWorkerId !== worker.id) {
    audioName = await uploadToWorker(worker.baseUrl, {
      bytes: await readFile(safeFile(ctx.env.attachmentsDir, project.audioPath)),
      name: `lv_${project.id.slice(0, 8)}.${extOf(project.audioName || 'song.mp3')}`,
      mime: project.audioMime || 'audio/mpeg',
    });
    await ctx.db.update(longVideoProjects).set({ comfyAudioName: audioName, comfyAudioWorkerId: worker.id }).where(eq(longVideoProjects.id, project.id));
  }
  const taskMode = project.taskMode === 'i2v' || project.taskMode === 'v2v' || project.taskMode === 'l2v' ? project.taskMode : 'ref';
  const segmentSeconds: number[] = [];
  const segments = [];
  for (const [index, scene] of chosen.entries()) {
    const slice = scene.endMs - scene.startMs;
    const planned = generationSeconds(slice);
    if (slice > 15_000) throw badRequest(planned.note ?? `Scene ${scene.position} is over 15 seconds. Split it before generating.`);
    const pool = refs.filter((ref) => ref.sceneId === scene.id || ref.sceneId == null);
    const pictures = orderByPlanName(pool, scene.imageOrder ?? []).slice(0, 8);
    if (!pictures.length) throw badRequest(`Add a reference picture to scene ${scene.position}, or one shared picture for the project.`);
    const images = [];
    for (const picture of pictures) {
      const imageName = await uploadToWorker(worker.baseUrl, {
        bytes: await readFile(safeFile(ctx.env.attachmentsDir, picture.path)),
        name: `lv_${picture.id.slice(0, 8)}.png`,
        mime: 'image/png',
      });
      images.push({ fileId: null, uploadName: imageName, uploadWorkerId: worker.id, shared: picture.sceneId == null });
    }
    segmentSeconds.push(planned.requestSec);
    segments.push({
      continuity: index === 0 ? 'shot' : 'context',
      taskMode,
      refImageSize: project.refSize === 'match' ? 'match' : 'max',
      prompt: scene.prompt.trim(),
      audioFileId: null,
      audioUploadName: audioName,
      audioUploadWorkerId: worker.id,
      audioTrim: true,
      audioStartSec: scene.startMs / 1000,
      audioUseSec: (scene.endMs - scene.startMs) / 1000,
      durationSec: planned.requestSec,
      images,
    });
  }
  const studio = await ensureStudioProject(ctx, project);
  const [job] = await ctx.db
    .insert(generationJobs)
    .values({
      orgId: ctx.orgId,
      projectId: studio.creativeProjectId,
      provider: 'comfyui-h3',
      status: 'QUEUED',
      settings: {
        longVideoProjectId: project.id,
        longVideoSceneId: chosen[0]!.id,
        longVideoSceneIds: chosen.map((scene) => scene.id),
        segmentSeconds,
        workerId: worker.id,
        projectName: studio.folder,
        variantId: studio.variantId,
        assetId: studio.assetId,
        assetVersionId: studio.assetVersionId,
        aspectRatio: h3Aspect(project.aspect),
        megapixels: project.megapixels === 0.5 || project.megapixels === 1.5 ? project.megapixels : 1,
        audioLocked: true,
        prompt: segments.map((segment) => segment.prompt).filter(Boolean).join('\n'),
        segments,
      },
      workflow: { format: 'api', source: 'MINIMAX H3 Motion Context FINAL API.json' },
    })
    .returning();
  for (const scene of chosen) {
    await ctx.db
      .update(longVideoScenes)
      .set({ status: 'QUEUED', jobId: job!.id, error: null, updatedAt: new Date() })
      .where(eq(longVideoScenes.id, scene.id));
  }
  await ctx.db.update(longVideoProjects).set({ status: 'GENERATING', updatedAt: new Date() }).where(eq(longVideoProjects.id, project.id));
  return { jobId: job!.id, sceneIds: chosen.map((scene) => scene.id), requestSec: segmentSeconds.reduce((sum, n) => sum + n, 0) };
}

export async function setLongVideoBatch(ctx: Ctx, projectId: string, state: 'run' | 'pause' | 'off') {
  const data = await getLongVideo(ctx, projectId);
  await ctx.db.update(longVideoProjects).set({ batchState: state, updatedAt: new Date() }).where(eq(longVideoProjects.id, projectId));
  if (state === 'run') {
    const busy = data.scenes.some((s) => s.status === 'QUEUED' || s.status === 'RUNNING');
    if (!busy) await queueNextLongVideoGroup(ctx, projectId);
  }
  return getLongVideo(ctx, projectId);
}

export async function requestLongVideoExport(ctx: Ctx, projectId: string) {
  const data = await getLongVideo(ctx, projectId);
  if (!data.project.audioPath) throw badRequest('Upload the song first.');
  const missing = data.scenes.filter((s) => !s.takePath);
  if (missing.length) throw badRequest(`${missing.length} scene${missing.length === 1 ? '' : 's'} still need a video.`);
  await ctx.db
    .update(longVideoProjects)
    .set({ exportStatus: 'QUEUED', exportError: null, updatedAt: new Date() })
    .where(eq(longVideoProjects.id, projectId));
  return { status: 'QUEUED' as const };
}

async function downloadWorkerFile(origin: string, stored: string) {
  const slash = stored.lastIndexOf('/');
  const url = new URL('/view', origin);
  url.searchParams.set('filename', slash >= 0 ? stored.slice(slash + 1) : stored);
  url.searchParams.set('type', 'output');
  if (slash >= 0) url.searchParams.set('subfolder', stored.slice(0, slash));
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`The PC did not return ${stored}.`);
  return Buffer.from(await res.arrayBuffer());
}

async function cutClip(source: string, start: number, duration: number, dest: string) {
  const copy = await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(start), '-t', String(duration), '-i', source, '-c', 'copy', dest]);
  if (!copy) return;
  const encoded = await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(start), '-t', String(duration), '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', dest]);
  if (encoded) throw new Error(encoded);
}

export async function reconcileLongVideos(db: Ctx['db'], env: ServiceEnv) {
  const done = await db.execute(sql`
    select j.id, j.org_id as "orgId", j.status, j.error, j.settings
    from generation_jobs j
    where j.provider = 'comfyui-h3'
      and j.status in ('SUCCEEDED', 'FAILED')
      and (j.settings ? 'longVideoSceneIds' or j.settings ? 'longVideoSceneId')
      and exists (
        select 1 from long_video_scenes s
        where s.job_id = j.id and s.status in ('QUEUED', 'RUNNING')
      )
    limit 5`);
  type JobRow = {
    id: string;
    orgId: string;
    status: string;
    error: string | null;
    settings: {
      longVideoSceneId?: string;
      longVideoSceneIds?: string[];
      longVideoProjectId?: string;
      segmentSeconds?: number[];
      workerId?: string;
      outputs?: { node?: string; filename: string; subfolder: string }[];
    };
  };
  for (const job of (done as unknown as { rows: JobRow[] }).rows) {
    const sceneIds = job.settings?.longVideoSceneIds?.length ? job.settings.longVideoSceneIds : job.settings?.longVideoSceneId ? [job.settings.longVideoSceneId] : [];
    const projectId = job.settings?.longVideoProjectId;
    if (!sceneIds.length || !projectId) continue;
    const combined = job.settings.outputs?.find((item) => item.node === '25') ?? job.settings.outputs?.[0];
    const combinedPath = combined ? (combined.subfolder ? `${combined.subfolder}/${combined.filename}` : combined.filename) : null;
    const localTakes = new Map<string, string>();
    if (job.status === 'SUCCEEDED' && combinedPath && sceneIds.length > 1) {
      const [worker] = await db.select().from(gpuWorkers).where(eq(gpuWorkers.id, job.settings.workerId ?? '')).limit(1);
      if (worker) {
        const dir = await mkdtemp(path.join(tmpdir(), 'lv-takes-'));
        try {
          const source = path.join(dir, 'combined.mp4');
          await writeFile(source, await downloadWorkerFile(worker.baseUrl, combinedPath));
          let cursor = 0;
          const lengths = job.settings.segmentSeconds ?? [];
          for (let i = 0; i < sceneIds.length; i++) {
            const duration = lengths[i] ?? 10;
            const rel = `long-videos/${projectId}/scenes/${sceneIds[i]}-${job.id.slice(0, 8)}.mp4`;
            const abs = safeFile(env.attachmentsDir, rel);
            await mkdir(path.dirname(abs), { recursive: true });
            await cutClip(source, cursor, duration, abs);
            localTakes.set(sceneIds[i]!, rel);
            cursor += duration;
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
    }
    for (const sceneId of sceneIds) {
      const [existing] = await db.select().from(longVideoScenes).where(eq(longVideoScenes.id, sceneId)).limit(1);
      if (!existing) continue;
      const local = localTakes.get(sceneId);
      const succeeded = job.status === 'SUCCEEDED' && (local || (sceneIds.length === 1 && combinedPath));
      await db
        .update(longVideoScenes)
        .set({
          status: succeeded ? 'READY' : existing.takePath || existing.shownJobId ? 'READY' : 'FAILED',
          takePath: succeeded ? (local ?? combinedPath) : existing.takePath,
          shownJobId: succeeded && !local ? job.id : existing.shownJobId,
          priorJobId: succeeded && existing.shownJobId && existing.shownJobId !== job.id ? existing.shownJobId : existing.priorJobId,
          priorTakePath: succeeded && existing.takePath && existing.takePath !== (local ?? combinedPath) ? existing.takePath : existing.priorTakePath,
          outdated: succeeded ? false : existing.outdated,
          error: succeeded ? null : job.error,
          updatedAt: new Date(),
        })
        .where(eq(longVideoScenes.id, sceneId));
    }
    const [project] = await db.select().from(longVideoProjects).where(eq(longVideoProjects.id, projectId)).limit(1);
    if (!project) continue;
    const scenes = await db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId));
    const ready = scenes.filter((s) => s.status === 'READY').length;
    await notify(db, {
      orgId: job.orgId,
      type: 'comfy.ready',
      dedupeKey: `long-video:${job.id}`,
      title: job.status === 'SUCCEEDED' ? `${project.title}: scene ready` : `${project.title}: scene failed`,
      body: job.status === 'SUCCEEDED' ? `${ready} of ${scenes.length} scenes have a video.` : job.error,
      deepLink: '/comfy#long',
      sourceType: 'long_video',
      sourceId: projectId,
    }).catch(() => undefined);
    if (project.batchState === 'run' && job.status === 'SUCCEEDED') {
      const ctx = { db, env, orgId: job.orgId, userId: null, actor: { type: 'system' as const }, now: () => new Date() };
      const next = await queueNextLongVideoGroup(ctx, projectId).catch(async (e: Error) => {
        await db.update(longVideoProjects).set({ batchState: 'pause', updatedAt: new Date() }).where(eq(longVideoProjects.id, projectId));
        return e;
      });
      if (!next) await db.update(longVideoProjects).set({ batchState: 'off', status: 'REVIEW', updatedAt: new Date() }).where(eq(longVideoProjects.id, projectId));
    }
  }
  const running = await db.execute(sql`
    update long_video_scenes s
    set status = 'RUNNING', updated_at = now()
    from generation_jobs j
    where s.job_id = j.id and j.status = 'RUNNING' and s.status = 'QUEUED'`);
  void running;
  const exports = await db.select().from(longVideoProjects).where(eq(longVideoProjects.exportStatus, 'QUEUED')).limit(1);
  for (const project of exports) {
    await assembleExport(db, env, project.id).catch(async (e: Error) => {
      await db.update(longVideoProjects).set({ exportStatus: 'FAILED', exportError: e.message.slice(0, 400), updatedAt: new Date() }).where(eq(longVideoProjects.id, project.id));
    });
  }
}

async function assembleExport(db: Ctx['db'], env: ServiceEnv, projectId: string) {
  const [project] = await db.select().from(longVideoProjects).where(eq(longVideoProjects.id, projectId)).limit(1);
  if (!project?.audioPath || !project.workerId) return;
  const [worker] = await db.select().from(gpuWorkers).where(eq(gpuWorkers.id, project.workerId)).limit(1);
  if (!worker) throw new Error('The PC for this export is gone.');
  const scenes = await db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  const dir = path.join(tmpdir(), `lv-${projectId}`);
  await mkdir(dir, { recursive: true });
  const list: string[] = [];
  for (const scene of scenes) {
    if (!scene.takePath) throw new Error(`Scene ${scene.position} has no video.`);
    const bytes = await downloadWorkerFile(worker.baseUrl, scene.takePath);
    const clip = path.join(dir, `${scene.position}.mp4`);
    await writeFile(clip, bytes);
    const trimmed = path.join(dir, `${scene.position}-cut.mp4`);
    const seconds = ((scene.endMs - scene.startMs) / 1000).toFixed(3);
    const err = await run('ffmpeg', ['-y', '-v', 'error', '-i', clip, '-t', seconds, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(project.fps), trimmed]);
    if (err) throw new Error(err);
    list.push(`file '${trimmed.replace(/'/g, "'\\''")}'`);
  }
  const listFile = path.join(dir, 'list.txt');
  await writeFile(listFile, list.join('\n'));
  const video = path.join(dir, 'video.mp4');
  const joined = await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', video]);
  if (joined) throw new Error(joined);
  const rel = `long-videos/${projectId}/exports/final.mp4`;
  const abs = safeFile(env.attachmentsDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  const audio = safeFile(env.attachmentsDir, project.audioPath);
  const mixed = await run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', abs]);
  if (mixed) throw new Error(mixed);
  await db.update(longVideoProjects).set({ exportStatus: 'READY', exportPath: rel, exportError: null, updatedAt: new Date() }).where(eq(longVideoProjects.id, projectId));
}
