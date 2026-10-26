import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generationJobs,
  generationOutputs,
  gpuWorkers,
  ltxDrafts,
  sql,
  type Db,
} from '@creatoros/db';
import {
  LTX_REQUIRED_MODELS,
  assertPrivateComfyUrl,
  buildLtxApiPrompt,
  ltxPresetFromApi,
  validateLtxDraft,
  type LtxPreset,
} from '@creatoros/domain';
import { openAgentFile } from './agent-file';
import { audit } from './audit';
import { AppError, badRequest, notFound, type Ctx, type ServiceEnv } from './types';

const API_FILE = 'LTX_IA2V_Production (API).json';
const LTX_FILE_MISSING =
  'The LTX workflow file is not on this server, so Generate cannot start. Saving a draft still works.';
const DEFAULT_MACHINES = [
  { label: 'RTX 3090', baseUrl: 'http://100.85.189.23:8188', role: 'primary' as const, expectedVramGb: 24 },
  { label: 'RTX 3060', baseUrl: 'http://100.113.189.17:8188', role: 'secondary' as const, expectedVramGb: 12 },
];
const MODEL_FOLDERS = [
  'unet',
  'diffusion_models',
  'checkpoints',
  'loras',
  'vae',
  'clip',
  'text_encoders',
  'audio_encoders',
  'embeddings',
];

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

export interface LtxForm {
  projectId: string | null;
  workerId: string | null;
  imageFileId: string | null;
  audioFileId: string | null;
  audioStartSec: number;
  durationSec: number;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  fps: number;
  loraStrength: number;
  wantUpscale: boolean;
}

interface MediaRow {
  id: string;
  fileName: string;
  fileType: string;
  durationMs: number | null;
}

let cached: { path: string; mtimeMs: number; sha256: string; preset: LtxPreset; graph: unknown } | null = null;

function workflowPath(name: string): string | null {
  const env = process.env.LTX_API_WORKFLOW;
  const candidates = [
    env,
    resolve(process.cwd(), 'docs/comfy', name),
    resolve(process.cwd(), 'packages/services/ltx', name),
    resolve(process.cwd(), '../../docs/comfy', name),
    resolve(process.cwd(), '../../packages/services/ltx', name),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function ltxApiWorkflow(): { path: string; sha256: string; preset: LtxPreset; graph: unknown } | null {
  const path = workflowPath(API_FILE);
  if (!path) return null;
  const mtimeMs = statSync(path).mtimeMs;
  if (!cached || cached.path !== path || cached.mtimeMs !== mtimeMs) {
    const bytes = readFileSync(path);
    let graph: unknown;
    let preset: LtxPreset;
    try {
      graph = JSON.parse(bytes.toString('utf8'));
      preset = ltxPresetFromApi(graph);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'The LTX API workflow could not be read.');
    }
    cached = { path, mtimeMs, sha256: createHash('sha256').update(bytes).digest('hex'), preset, graph };
  }
  return cached;
}

async function media(ctx: Ctx, id: string | null, kind: 'IMAGE' | 'AUDIO'): Promise<MediaRow | null> {
  if (!id) return null;
  const row = rowsOf<MediaRow>(
    await ctx.db.execute(sql`
      select id, file_name as "fileName", file_type as "fileType",
             nullif(tech->>'durationMs', '')::float8 as "durationMs"
      from file_instances
      where id = ${id} and org_id = ${ctx.orgId} and archived_at is null`),
  )[0];
  if (!row) throw badRequest(kind === 'IMAGE' ? 'That image is not in the library.' : 'That audio is not in the library.');
  if (row.fileType !== kind) {
    throw badRequest(kind === 'IMAGE' ? 'Choose an image, not another kind of file.' : 'Choose an audio file.');
  }
  return row;
}

async function workerOrNull(ctx: Ctx, id: string | null) {
  if (!id) return null;
  const [row] = await ctx.db
    .select()
    .from(gpuWorkers)
    .where(sql`${gpuWorkers.id} = ${id} and ${gpuWorkers.orgId} = ${ctx.orgId}`)
    .limit(1);
  if (!row) throw badRequest('That PC is not in the list.');
  if (!row.enabled) throw badRequest('That PC is turned off in Creator OS.');
  return row;
}

export async function listGpuWorkers(ctx: Ctx) {
  return ctx.db
    .select()
    .from(gpuWorkers)
    .where(sql`${gpuWorkers.orgId} = ${ctx.orgId}`)
    .orderBy(sql`${gpuWorkers.role} asc, ${gpuWorkers.label} asc`);
}

export async function saveGpuWorker(
  ctx: Ctx,
  input: { label: string; baseUrl: string; role: 'primary' | 'secondary'; expectedVramGb: number | null },
) {
  let origin: string;
  try {
    origin = assertPrivateComfyUrl(input.baseUrl);
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'That address is not usable.');
  }
  const label = input.label.trim();
  if (!label) throw badRequest('Name the PC.');
  try {
    const [row] = await ctx.db
      .insert(gpuWorkers)
      .values({
        orgId: ctx.orgId,
        label,
        baseUrl: origin,
        role: input.role,
        expectedVramGb: input.expectedVramGb,
      })
      .returning();
    await audit(ctx, 'comfy.worker.add', { type: 'gpu_worker', id: row!.id }, undefined, {
      label,
      role: input.role,
      expectedVramGb: input.expectedVramGb,
    });
    return row!;
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') throw badRequest('That address is already in the list.');
    throw e;
  }
}

export async function removeGpuWorker(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .delete(gpuWorkers)
    .where(sql`${gpuWorkers.id} = ${id} and ${gpuWorkers.orgId} = ${ctx.orgId}`)
    .returning({ id: gpuWorkers.id, label: gpuWorkers.label });
  if (!row) throw notFound('PC');
  await audit(ctx, 'comfy.worker.remove', { type: 'gpu_worker', id }, undefined, { label: row.label });
  return { id: row.id };
}

/** Asks the PC who it is and which model files it lists. Does not queue a render. */
export async function checkGpuWorker(ctx: Ctx, id: string) {
  const worker = await workerOrNull(ctx, id);
  if (!worker) throw notFound('PC');
  const checkedAt = ctx.now();
  let lastOk = false;
  let lastError: string | null = 'Creator OS could not reach that ComfyUI.';
  let reportedVramGb: number | null = null;
  let comfyVersion: string | null = null;
  let deviceName: string | null = null;
  let missingModels: string[] = [];
  try {
    const statsRes = await fetch(new URL('/system_stats', worker.baseUrl), {
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
    });
    if (statsRes.status >= 300 && statsRes.status < 400) {
      lastError = 'ComfyUI redirected the check. Use the address of the ComfyUI port itself.';
    } else if (!statsRes.ok) {
      lastError = `ComfyUI answered HTTP ${statsRes.status}.`;
    } else {
      const stats = (await statsRes.json()) as {
        system?: { comfyui_version?: string };
        devices?: { name?: string; vram_total?: number }[];
      };
      const best = [...(stats.devices ?? [])].sort((a, b) => (b.vram_total ?? 0) - (a.vram_total ?? 0))[0];
      reportedVramGb = best?.vram_total ? Math.round((best.vram_total / 1024 ** 3) * 10) / 10 : null;
      deviceName = best?.name ?? null;
      comfyVersion = stats.system?.comfyui_version ?? null;
      const listed = new Set<string>();
      let anyList = false;
      for (const folder of MODEL_FOLDERS) {
        const res = await fetch(new URL(`/models/${folder}`, worker.baseUrl), {
          signal: AbortSignal.timeout(8000),
          redirect: 'manual',
        });
        if (!res.ok) continue;
        const body = (await res.json()) as unknown;
        if (!Array.isArray(body)) continue;
        anyList = true;
        for (const name of body) if (typeof name === 'string') listed.add(name.split(/[\\/]/).pop() ?? name);
      }
      missingModels = anyList ? LTX_REQUIRED_MODELS.filter((name) => !listed.has(name)) : [...LTX_REQUIRED_MODELS];
      lastOk = true;
      lastError = !anyList
        ? 'Connected. ComfyUI did not list its model folders, so the LTX files could not be confirmed.'
        : missingModels.length
          ? `Connected. These models were not listed: ${missingModels.join(', ')}`
          : null;
    }
  } catch {
    lastError = 'Creator OS could not reach that ComfyUI.';
  }
  const [saved] = await ctx.db
    .update(gpuWorkers)
    .set({
      lastCheckedAt: checkedAt,
      lastOk,
      lastError,
      reportedVramGb,
      comfyVersion,
      deviceName,
      updatedAt: checkedAt,
    })
    .where(sql`${gpuWorkers.id} = ${worker.id}`)
    .returning();
  return { worker: saved!, missingModels, prompted: false };
}

async function ensureDefaultMachines(ctx: Ctx) {
  const existing = await listGpuWorkers(ctx);
  if (existing.length) return existing;
  for (const machine of DEFAULT_MACHINES) {
    await ctx.db.insert(gpuWorkers).values({ orgId: ctx.orgId, ...machine, enabled: true }).onConflictDoNothing();
  }
  return listGpuWorkers(ctx);
}

export async function getLtxStudio(ctx: Ctx) {
  const workflow = ltxApiWorkflow();
  const workers = await ensureDefaultMachines(ctx);
  const [draft] = await ctx.db
    .select()
    .from(ltxDrafts)
    .where(sql`${ltxDrafts.orgId} = ${ctx.orgId}`)
    .limit(1);
  const names = draft
    ? rowsOf<{ imageName: string | null; audioName: string | null; audioDurationMs: number | null }>(
        await ctx.db.execute(sql`
          select
            (select file_name from file_instances where id = ${draft.imageFileId} and org_id = ${ctx.orgId}) as "imageName",
            (select file_name from file_instances where id = ${draft.audioFileId} and org_id = ${ctx.orgId}) as "audioName",
            (select nullif(tech->>'durationMs', '')::float8 from file_instances where id = ${draft.audioFileId} and org_id = ${ctx.orgId}) as "audioDurationMs"`),
      )[0]
    : null;
  const jobs = rowsOf<{
    id: string;
    status: string;
    error: string | null;
    createdAt: Date;
    projectId: string | null;
    settings: Record<string, unknown>;
  }>(
    await ctx.db.execute(sql`
      select id, status, error, created_at as "createdAt", project_id as "projectId", settings
      from generation_jobs
      where org_id = ${ctx.orgId} and provider = 'comfyui-ltx'
      order by created_at desc
      limit 20`),
  );
  return {
    preset: workflow?.preset ?? null,
    sha256: workflow?.sha256 ?? null,
    apiExportPresent: workflow != null,
    generation: workflow ? ('READY' as const) : ('BLOCKED' as const),
    blockReason: workflow ? null : LTX_FILE_MISSING,
    workers,
    draft: draft ? { ...draft, ...(names ?? {}) } : null,
    jobs: jobs.map((j) => ({ ...j, outcome: j.status })),
  };
}

async function checkedForm(ctx: Ctx, form: LtxForm, opts: { requireMedia: boolean; requireWorker: boolean }) {
  const image = await media(ctx, form.imageFileId, 'IMAGE');
  const audio = await media(ctx, form.audioFileId, 'AUDIO');
  const worker = await workerOrNull(ctx, form.workerId);
  if (form.projectId) {
    const found = rowsOf<{ id: string }>(
      await ctx.db.execute(sql`select id from creative_projects where id = ${form.projectId} and org_id = ${ctx.orgId} and deleted_at is null`),
    )[0];
    if (!found) throw badRequest('That project is not in this workspace.');
  }
  const audioLengthSec = audio?.durationMs != null ? audio.durationMs / 1000 : null;
  const result = validateLtxDraft(
    { ...form, audioLengthSec, expectedVramGb: worker?.expectedVramGb ?? null },
    opts,
  );
  return { image, audio, worker, audioLengthSec, ...result };
}

export async function saveLtxDraft(ctx: Ctx, form: LtxForm) {
  const checked = await checkedForm(ctx, form, { requireMedia: false, requireWorker: false });
  if (checked.errors.length) throw badRequest(checked.errors[0]!.message, checked.errors);
  const now = ctx.now();
  const [row] = await ctx.db
    .insert(ltxDrafts)
    .values({ orgId: ctx.orgId, ...form, updatedBy: ctx.userId, updatedAt: now })
    .onConflictDoUpdate({
      target: ltxDrafts.orgId,
      set: { ...form, updatedBy: ctx.userId, updatedAt: now },
    })
    .returning();
  return { draft: row!, warnings: checked.warnings };
}

export async function validateLtx(ctx: Ctx, form: LtxForm) {
  const checked = await checkedForm(ctx, form, { requireMedia: true, requireWorker: false });
  const workflow = ltxApiWorkflow();
  return {
    ok: checked.errors.length === 0,
    errors: checked.errors,
    warnings: checked.warnings,
    generation: workflow ? ('READY' as const) : ('BLOCKED' as const),
    blockReason: workflow ? null : LTX_FILE_MISSING,
    prompted: false,
  };
}

/** Queues a render. The worker uploads the image and audio, then posts the API prompt. */
export async function generateLtx(ctx: Ctx, form: LtxForm) {
  const workflow = ltxApiWorkflow();
  if (!workflow) throw badRequest(LTX_FILE_MISSING);
  const checked = await checkedForm(ctx, form, { requireMedia: true, requireWorker: true });
  if (checked.errors.length) throw badRequest(checked.errors[0]!.message, checked.errors);
  await saveLtxDraft(ctx, form);
  const [job] = await ctx.db
    .insert(generationJobs)
    .values({
      orgId: ctx.orgId,
      projectId: form.projectId,
      provider: 'comfyui-ltx',
      status: 'QUEUED',
      settings: {
        workerId: form.workerId,
        workerLabel: checked.worker?.label ?? null,
        imageFileId: form.imageFileId,
        imageName: checked.image?.fileName ?? null,
        audioFileId: form.audioFileId,
        audioName: checked.audio?.fileName ?? null,
        audioStartSec: form.audioStartSec,
        durationSec: form.durationSec,
        width: form.width,
        height: form.height,
        fps: form.fps,
        loraStrength: form.loraStrength,
        wantUpscale: form.wantUpscale,
        prompt: form.prompt,
        negativePrompt: form.negativePrompt,
      },
      workflow: {
        format: 'api',
        executable: true,
        sha256: workflow.sha256,
        source: API_FILE,
      },
    })
    .returning();
  await audit(ctx, 'comfy.ltx.generate', { type: 'generation_job', id: job!.id }, undefined, {
    workerLabel: checked.worker?.label ?? null,
  });
  return {
    job: { ...job!, outcome: 'QUEUED' as const },
    warnings: checked.warnings,
    generation: 'QUEUED' as const,
    blockReason: null,
    prompted: true,
  };
}

interface LtxSettings {
  workerId?: string;
  workerLabel?: string;
  imageFileId?: string;
  audioFileId?: string;
  audioStartSec?: number;
  durationSec?: number;
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  fps?: number;
  loraStrength?: number;
  wantUpscale?: boolean;
  filenamePrefix?: string;
  outputs?: { node: string; filename: string; subfolder: string; type: string }[];
}

interface ClaimedJob {
  id: string;
  orgId: string;
  promptId: string | null;
  settings: LtxSettings;
  startedAt: Date | null;
}

async function readUpload(file: { body: ReadableStream<Uint8Array>; name: string; mime: string }, jobId: string) {
  const reader = file.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cap = 250 * 1024 * 1024;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > cap) throw badRequest('That file is over 250 MB, so it was not sent to ComfyUI.');
    chunks.push(next.value);
  }
  const base = (file.name.split(/[/\\]/).pop() || 'file').replace(/[^A-Za-z0-9._-]+/g, '_');
  return { bytes: Buffer.concat(chunks), name: `cos_${jobId.slice(0, 8)}_${base}`, mime: file.mime || 'application/octet-stream' };
}

async function uploadToComfy(origin: string, file: { bytes: Buffer; name: string; mime: string }) {
  const form = new FormData();
  form.append('image', new Blob([Uint8Array.from(file.bytes)], { type: file.mime }), file.name);
  form.append('overwrite', 'true');
  form.append('type', 'input');
  let res: Response;
  try {
    res = await fetch(new URL('/upload/image', origin), { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw badRequest('Creator OS could not reach that ComfyUI to send the image or audio.');
  }
  if (!res.ok) throw badRequest(`ComfyUI refused the file (${res.status}).`);
  const body = (await res.json()) as { name?: string; subfolder?: string };
  if (!body.name) throw badRequest('ComfyUI did not accept the file.');
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

function comfyError(body: { node_errors?: Record<string, unknown>; error?: { message?: string } }): string | null {
  const nodes = body.node_errors ?? {};
  const first = Object.entries(nodes)[0];
  if (first) return `ComfyUI rejected node ${first[0]}. ${JSON.stringify(first[1]).slice(0, 500)}`;
  if (body.error?.message) return body.error.message.slice(0, 500);
  return null;
}

async function failJob(db: Db, id: string, message: string) {
  await db.execute(sql`
    update generation_jobs
    set status = 'FAILED', error = ${message.slice(0, 2000)}, finished_at = now(), updated_at = now()
    where id = ${id} and status in ('QUEUED', 'RUNNING')`);
}

/** Uploads the chosen files and posts the API prompt. Safe to call twice: a claimed job is not posted again. */
export async function submitLtxJob(db: Db, env: ServiceEnv, jobId: string) {
  const claimed = rowsOf<ClaimedJob>(
    await db.execute(sql`
      update generation_jobs
      set status = 'RUNNING', started_at = now(), updated_at = now(), error = null
      where id = ${jobId} and provider = 'comfyui-ltx' and status = 'QUEUED'
      returning id, org_id as "orgId", prompt_id as "promptId", settings, started_at as "startedAt"`),
  )[0];
  if (!claimed) return { skipped: true };
  try {
    const workflow = ltxApiWorkflow();
    if (!workflow) throw badRequest(LTX_FILE_MISSING);
    const settings = claimed.settings ?? {};
    const [worker] = await db
      .select()
      .from(gpuWorkers)
      .where(sql`${gpuWorkers.id} = ${settings.workerId ?? null} and ${gpuWorkers.orgId} = ${claimed.orgId}`)
      .limit(1);
    if (!worker?.enabled) throw badRequest('The PC for this job is no longer in the list.');
    const image = await readUpload(await openAgentFile(db, env, claimed.orgId, String(settings.imageFileId)), claimed.id);
    const audio = await readUpload(await openAgentFile(db, env, claimed.orgId, String(settings.audioFileId)), claimed.id);
    const imageName = await uploadToComfy(worker.baseUrl, image);
    const audioName = await uploadToComfy(worker.baseUrl, audio);
    const prefix = `CreatorOS/ltx_${claimed.id.slice(0, 8)}`;
    const seed = Math.floor(Math.random() * 1_000_000_000_000_000);
    const prompt = buildLtxApiPrompt(workflow.graph, {
      imageName,
      audioName,
      prompt: settings.prompt ?? '',
      negativePrompt: settings.negativePrompt ?? '',
      width: Number(settings.width),
      height: Number(settings.height),
      fps: Number(settings.fps),
      durationSec: Number(settings.durationSec),
      audioStartSec: Number(settings.audioStartSec),
      loraStrength: Number(settings.loraStrength),
      wantUpscale: settings.wantUpscale !== false,
      filenamePrefix: prefix,
      seed,
    });
    let res: Response;
    try {
      res = await fetch(new URL('/prompt', worker.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw badRequest('Creator OS could not reach that ComfyUI to start the video.');
    }
    const body = (await res.json().catch(() => ({}))) as {
      prompt_id?: string;
      node_errors?: Record<string, unknown>;
      error?: { message?: string };
    };
    const rejected = comfyError(body);
    if (!res.ok || rejected || !body.prompt_id) throw badRequest(rejected || `ComfyUI did not start the video (${res.status}).`);
    await db.execute(sql`
      update generation_jobs
      set prompt_id = ${body.prompt_id}, external_job_id = ${body.prompt_id},
          settings = settings || ${JSON.stringify({ filenamePrefix: prefix, seed })}::jsonb,
          updated_at = now()
      where id = ${claimed.id}`);
    return { promptId: body.prompt_id };
  } catch (e) {
    const message =
      e instanceof AppError && e.code === 'DEVICE_OFFLINE'
        ? 'The PC that holds the image or audio is offline, so the video was not started.'
        : e instanceof Error
          ? e.message
          : 'The video did not start.';
    await failJob(db, claimed.id, message);
    return { failed: message };
  }
}

export async function submitQueuedLtx(db: Db, env: ServiceEnv) {
  const waiting = rowsOf<{ id: string }>(
    await db.execute(sql`
      select id from generation_jobs
      where provider = 'comfyui-ltx' and status = 'QUEUED'
      order by created_at asc
      limit 2`),
  );
  const out = [];
  for (const job of waiting) out.push(await submitLtxJob(db, env, job.id));
  return out;
}

interface HistoryOutput {
  filename?: string;
  subfolder?: string;
  type?: string;
}

function videosFromHistory(entry: { outputs?: Record<string, { gifs?: HistoryOutput[]; videos?: HistoryOutput[] }>; status?: { status_str?: string; completed?: boolean; messages?: unknown[] } }) {
  const message = (entry.status?.messages ?? []).find((m) => Array.isArray(m) && m[0] === 'execution_error') as
    | [string, { exception_message?: string }]
    | undefined;
  const outputs: LtxSettings['outputs'] = [];
  for (const [node, out] of Object.entries(entry.outputs ?? {})) {
    for (const file of [...(out.gifs ?? []), ...(out.videos ?? [])]) {
      if (!file.filename) continue;
      if (!/\.(mp4|webm|mkv|mov)$/i.test(file.filename)) continue;
      outputs.push({ node, filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' });
    }
  }
  return { outputs, error: message?.[1]?.exception_message, status: entry.status?.status_str, completed: entry.status?.completed === true };
}

export async function pollRunningLtx(db: Db, env: ServiceEnv) {
  void env;
  const running = rowsOf<ClaimedJob>(
    await db.execute(sql`
      select id, org_id as "orgId", prompt_id as "promptId", settings, started_at as "startedAt"
      from generation_jobs
      where provider = 'comfyui-ltx' and status = 'RUNNING'
      order by started_at asc
      limit 10`),
  );
  let updated = 0;
  for (const job of running) {
    if (!job.promptId) {
      const age = Date.now() - new Date(job.startedAt ?? 0).getTime();
      if (age > 3 * 60_000) await failJob(db, job.id, 'The video did not start. Press Generate again.');
      continue;
    }
    const [worker] = await db
      .select()
      .from(gpuWorkers)
      .where(sql`${gpuWorkers.id} = ${job.settings?.workerId ?? null} and ${gpuWorkers.orgId} = ${job.orgId}`)
      .limit(1);
    if (!worker) {
      await failJob(db, job.id, 'The PC for this job was removed.');
      continue;
    }
    let entry: ReturnType<typeof videosFromHistory> | null = null;
    let missing = false;
    try {
      const res = await fetch(new URL(`/history/${job.promptId}`, worker.baseUrl), { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const body = (await res.json()) as Record<string, Parameters<typeof videosFromHistory>[0]>;
        const raw = body[job.promptId];
        if (raw) entry = videosFromHistory(raw);
        else missing = true;
      }
    } catch {
      continue;
    }
    if (!entry) {
      if (!missing) continue;
      const age = Date.now() - new Date(job.startedAt ?? 0).getTime();
      if (age < 2 * 60_000) continue;
      let queued = false;
      try {
        const q = await fetch(new URL('/queue', worker.baseUrl), { signal: AbortSignal.timeout(10_000) });
        queued = q.ok && (await q.text()).includes(job.promptId);
      } catch {
        continue;
      }
      if (!queued && age > 10 * 60_000) await failJob(db, job.id, 'ComfyUI is no longer running this video.');
      continue;
    }
    if (entry.status === 'error' || (entry.completed && entry.error)) {
      await failJob(db, job.id, entry.error || 'ComfyUI stopped this video.');
      updated += 1;
      continue;
    }
    if (!entry.completed) continue;
    const saved = rowsOf<{ id: string }>(
      await db.execute(sql`
        update generation_jobs
        set status = 'SUCCEEDED', finished_at = now(), updated_at = now(), error = null,
            settings = settings || ${JSON.stringify({ outputs: entry.outputs })}::jsonb
        where id = ${job.id} and status = 'RUNNING'
        returning id`),
    );
    if (!saved.length) continue;
    for (const output of entry.outputs ?? []) {
      await db.insert(generationOutputs).values({
        orgId: job.orgId,
        jobId: job.id,
        node: output.node,
        outputRole: output.node === '610' ? 'upscale' : 'preview',
        expectedPath: output.subfolder ? `${output.subfolder}/${output.filename}` : output.filename,
      });
    }
    await db.execute(sql`
      update generation_outputs o
      set file_instance_id = f.id
      from file_instances f
      where o.job_id = ${job.id} and o.file_instance_id is null
        and f.org_id = o.org_id and f.archived_at is null
        and f.file_name = regexp_replace(o.expected_path, '^.*/', '')`);
    updated += 1;
  }
  return { checked: running.length, updated };
}

/** Streams the finished video from the PC that rendered it. The browser never sees that address. */
export async function openLtxVideo(db: Db, orgId: string, jobId: string, range?: string) {
  const [job] = rowsOf<{ settings: LtxSettings; status: string }>(
    await db.execute(sql`
      select settings, status from generation_jobs
      where id = ${jobId} and org_id = ${orgId} and provider = 'comfyui-ltx'`),
  );
  if (!job) throw notFound('Video');
  const outputs = job.settings?.outputs ?? [];
  const video =
    outputs.find((o) => o.node === '610' && /-audio\.mp4$/i.test(o.filename)) ??
    outputs.find((o) => o.node === '610' && /\.mp4$/i.test(o.filename)) ??
    outputs.find((o) => /-audio\.mp4$/i.test(o.filename)) ??
    outputs.find((o) => /\.mp4$/i.test(o.filename));
  if (!video) throw notFound('Video');
  const [worker] = await db
    .select()
    .from(gpuWorkers)
    .where(sql`${gpuWorkers.id} = ${job.settings?.workerId ?? null} and ${gpuWorkers.orgId} = ${orgId}`)
    .limit(1);
  if (!worker) throw badRequest('The PC that made this video is no longer in the list.');
  const url = new URL('/view', worker.baseUrl);
  url.searchParams.set('filename', video.filename);
  url.searchParams.set('subfolder', video.subfolder);
  url.searchParams.set('type', video.type || 'output');
  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: range ? { range } : {}, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw badRequest('Creator OS could not reach the PC that has this video.');
  }
  return { upstream, filename: video.filename };
}
