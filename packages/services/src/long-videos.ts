import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  and,
  eq,
  generationJobs,
  gpuWorkers,
  longVideoProjects,
  longVideoRefs,
  longVideoScenes,
  sql,
} from '@creatoros/db';
import { generationSeconds, planGenerationGroups, planScenes, type SceneSpan } from '@creatoros/domain';
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
          outdated: Boolean(row.takePath),
          updatedAt: new Date(),
        })
        .where(eq(longVideoScenes.id, row.id));
    } else {
      await ctx.db.insert(longVideoScenes).values({ projectId, position: i + 1, startMs: span.startMs, endMs: span.endMs });
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
    .where(eq(longVideoProjects.orgId, ctx.orgId))
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
  return row!;
}

async function owned(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(longVideoProjects)
    .where(and(eq(longVideoProjects.id, id), eq(longVideoProjects.orgId, ctx.orgId)))
    .limit(1);
  if (!row) throw notFound('Long video');
  return row;
}

export async function getLongVideo(ctx: Ctx, id: string) {
  const project = await owned(ctx, id);
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, id)).orderBy(longVideoScenes.position);
  const refs = await ctx.db.select().from(longVideoRefs).where(eq(longVideoRefs.projectId, id));
  const workers = await ctx.db
    .select({ id: gpuWorkers.id, label: gpuWorkers.label, enabled: gpuWorkers.enabled })
    .from(gpuWorkers)
    .where(eq(gpuWorkers.orgId, ctx.orgId));
  return { project, scenes, refs, workers };
}

const H3_ASPECTS = [
  '9:16 (Portrait Widescreen)',
  '16:9 (Widescreen)',
  '1:1 (Square)',
  '2:3 (Portrait Photo)',
  '3:2 (Photo)',
  '3:4 (Portrait Standard)',
  '4:3 (Standard)',
  '21:9 (Ultrawide)',
] as const;

function h3Aspect(stored: string) {
  if (stored === '9:16' || stored.startsWith('9:16')) return '9:16 (Portrait Widescreen)';
  if (stored === '16:9' || stored.includes('16:9')) return '16:9 (Widescreen)';
  return H3_ASPECTS.includes(stored as (typeof H3_ASPECTS)[number]) ? stored : '16:9 (Widescreen)';
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
      ...(patch.aspect && H3_ASPECTS.includes(patch.aspect as (typeof H3_ASPECTS)[number]) ? { aspect: patch.aspect } : {}),
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
  return row!;
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

export async function rebalanceLongVideo(ctx: Ctx, id: string) {
  const project = await owned(ctx, id);
  if (!project.durationMs) {
    throw badRequest('This project has no song length yet. The upload did not finish, so choose the song again. Rebuild only splits a song that already has a length.');
  }
  await replaceScenes(ctx, id, planScenes(project.durationMs, project.targetSceneMs));
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
      ...(patch.prompt != null ? { prompt: patch.prompt.slice(0, 4000) } : {}),
      ...(patch.mode === 'vocal' || patch.mode === 'broll' ? { mode: patch.mode } : {}),
      ...(patch.continuity === 'shot' || patch.continuity === 'context' ? { continuity: patch.continuity } : {}),
      ...(patch.workerId !== undefined ? { workerId: patch.workerId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(longVideoScenes.id, sceneId), eq(longVideoScenes.projectId, projectId)))
    .returning();
  if (!row) throw notFound('Scene');
  return row;
}

/** A shorter scene gives the spare time to the next one. A longer scene takes that time from the next one. The last scene trades with the one before it. */
async function resizeLongVideoScene(ctx: Ctx, projectId: string, sceneId: string, durationSec: number) {
  const scenes = await ctx.db.select().from(longVideoScenes).where(eq(longVideoScenes.projectId, projectId)).orderBy(longVideoScenes.position);
  const index = scenes.findIndex((s) => s.id === sceneId);
  if (index < 0) throw notFound('Scene');
  const scene = scenes[index]!;
  if (scene.status === 'QUEUED' || scene.status === 'RUNNING') throw badRequest('Wait until this scene finishes before changing its length.');
  const want = Math.round(durationSec * 1000);
  if (want < 1000) throw badRequest('A scene needs at least 1 second.');
  const next = scenes[index + 1];
  const prev = scenes[index - 1];
  const partner = next ?? prev;
  if (!partner) throw badRequest('This is the only scene, so its length stays the length of the song.');
  const current = scene.endMs - scene.startMs;
  const delta = want - current;
  if (delta === 0) return;
  const partnerLen = partner.endMs - partner.startMs;
  if (partnerLen - delta < 1000) throw badRequest('That would leave the neighbouring scene under 1 second.');
  if (next) {
    await ctx.db
      .update(longVideoScenes)
      .set({ endMs: scene.endMs + delta, outdated: Boolean(scene.takePath), updatedAt: new Date() })
      .where(eq(longVideoScenes.id, scene.id));
    await ctx.db
      .update(longVideoScenes)
      .set({ startMs: next.startMs + delta, outdated: Boolean(next.takePath), updatedAt: new Date() })
      .where(eq(longVideoScenes.id, next.id));
  } else if (prev) {
    await ctx.db
      .update(longVideoScenes)
      .set({ startMs: scene.startMs - delta, outdated: Boolean(scene.takePath), updatedAt: new Date() })
      .where(eq(longVideoScenes.id, scene.id));
    await ctx.db
      .update(longVideoScenes)
      .set({ endMs: prev.endMs - delta, outdated: Boolean(prev.takePath), updatedAt: new Date() })
      .where(eq(longVideoScenes.id, prev.id));
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
    label: scene.label,
    mode: scene.mode,
    prompt: scene.prompt,
  });
  for (const later of scenes.filter((s) => s.position > scene.position)) {
    await ctx.db.update(longVideoScenes).set({ position: later.position + 1 }).where(eq(longVideoScenes.id, later.id));
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
    await ctx.db.update(longVideoScenes).set({ position: i + 1 }).where(eq(longVideoScenes.id, left[i]!.id));
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

export async function removeLongVideoRef(ctx: Ctx, projectId: string, refId: string) {
  await owned(ctx, projectId);
  await ctx.db.delete(longVideoRefs).where(and(eq(longVideoRefs.id, refId), eq(longVideoRefs.projectId, projectId)));
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
    if (scene.takePath?.startsWith('long-videos/')) {
      parts.push({ name, abs: safeFile(ctx.env.attachmentsDir, scene.takePath) });
      continue;
    }
    const jobId = scene.shownJobId ?? (scene.status === 'READY' ? scene.jobId : null);
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
  const refs = await ctx.db.select().from(longVideoRefs).where(eq(longVideoRefs.projectId, projectId));
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
    const picture = refs.find((ref) => ref.sceneId === scene.id) ?? refs.find((ref) => ref.sceneId == null);
    if (!picture) throw badRequest(`Add a reference picture to scene ${scene.position}, or one shared picture for the project.`);
    const imageName = await uploadToWorker(worker.baseUrl, {
      bytes: await readFile(safeFile(ctx.env.attachmentsDir, picture.path)),
      name: `lv_${picture.id.slice(0, 8)}.png`,
      mime: 'image/png',
    });
    segmentSeconds.push(planned.requestSec);
    segments.push({
      continuity: index === 0 ? 'shot' : 'context',
      taskMode,
      refImageSize: project.refSize === 'match' ? 'match' : 'max',
      prompt: scene.prompt.trim().slice(0, 4000),
      audioFileId: null,
      audioUploadName: audioName,
      audioUploadWorkerId: worker.id,
      audioTrim: true,
      audioStartSec: scene.startMs / 1000,
      audioUseSec: planned.requestSec,
      durationSec: planned.requestSec,
      images: [{ fileId: null, uploadName: imageName, uploadWorkerId: worker.id, shared: false }],
    });
  }
  const [job] = await ctx.db
    .insert(generationJobs)
    .values({
      orgId: ctx.orgId,
      provider: 'comfyui-h3',
      status: 'QUEUED',
      settings: {
        longVideoProjectId: project.id,
        longVideoSceneId: chosen[0]!.id,
        longVideoSceneIds: chosen.map((scene) => scene.id),
        segmentSeconds,
        workerId: worker.id,
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
