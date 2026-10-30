import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assetFileLinks,
  assetVersions,
  distributionVariants,
  generationJobs,
  generationOutputs,
  gpuWorkers,
  logicalAssets,
  ltxDrafts,
  sql,
  type Db,
} from '@creatoros/db';
import {
  LTX_REQUIRED_MODELS,
  assertPrivateComfyUrl,
  buildLtxApiPrompt,
  fitRtxUpscaleInputs,
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
  loraName: string;
  loraStrength: number;
  upscaleWidth: number;
  upscaleHeight: number;
  wantUpscale: boolean;
  imageUploadName: string | null;
  imageUploadWorkerId: string | null;
  audioUploadName: string | null;
  audioUploadWorkerId: string | null;
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

/** One look at ComfyUI’s queue. The LTX page asks again when that PC is chosen. */
async function readWorkerQueue(baseUrl: string): Promise<'busy' | 'free' | 'offline'> {
  try {
    const res = await fetch(new URL('/queue', baseUrl), { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return 'offline';
    const body = (await res.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
    const running = Array.isArray(body.queue_running) ? body.queue_running.length : 0;
    const pending = Array.isArray(body.queue_pending) ? body.queue_pending.length : 0;
    return running + pending > 0 ? 'busy' : 'free';
  } catch {
    return 'offline';
  }
}

/** Queue for one saved PC. Does not start a render. */
export async function workerQueue(ctx: Ctx, workerId: string) {
  const worker = await workerOrNull(ctx, workerId);
  if (!worker) throw notFound('PC');
  const queue = worker.enabled ? await readWorkerQueue(worker.baseUrl) : ('offline' as const);
  return { id: worker.id, queue };
}

export async function getLtxStudio(ctx: Ctx) {
  const workflow = ltxApiWorkflow();
  const listed = await ensureDefaultMachines(ctx);
  const workers = await Promise.all(
    listed.map(async (w) => ({
      ...w,
      queue: w.enabled ? await readWorkerQueue(w.baseUrl) : ('offline' as const),
    })),
  );
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
    projectTitle: string | null;
    settings: Record<string, unknown>;
  }>(
    await ctx.db.execute(sql`
      select j.id, j.status, j.error, j.created_at as "createdAt", j.project_id as "projectId",
             coalesce(p.title, j.settings->>'projectTitle') as "projectTitle", j.settings
      from generation_jobs j
      left join creative_projects p on p.id = j.project_id and p.org_id = j.org_id and p.deleted_at is null
      where j.org_id = ${ctx.orgId} and j.provider = 'comfyui-ltx'
      order by j.created_at desc
      limit 20`),
  );
  const outputs = jobs.length
    ? rowsOf<{
        jobId: string;
        fileId: string | null;
        expectedPath: string | null;
        fileName: string | null;
        displayPath: string | null;
        deviceName: string | null;
        assetId: string | null;
        assetTitle: string | null;
      }>(
        await ctx.db.execute(sql`
          select o.job_id as "jobId", o.file_instance_id as "fileId", o.expected_path as "expectedPath",
                 f.file_name as "fileName", f.display_path as "displayPath", d.display_name as "deviceName",
                 a.id as "assetId", a.title as "assetTitle"
          from generation_outputs o
          left join file_instances f on f.id = o.file_instance_id
          left join devices d on d.id = f.device_id
          left join lateral (
            select la.id, la.title
            from asset_file_links l
            join asset_versions v on v.id = l.asset_version_id
            join logical_assets la on la.id = v.asset_id
            where l.file_instance_id = f.id and la.is_archived = false
            limit 1
          ) a on true
          where o.org_id = ${ctx.orgId} and o.job_id in (${sql.join(jobs.map((j) => sql`${j.id}::uuid`), sql`, `)})`),
      )
    : [];
  return {
    preset: workflow?.preset ?? null,
    sha256: workflow?.sha256 ?? null,
    apiExportPresent: workflow != null,
    generation: workflow ? ('READY' as const) : ('BLOCKED' as const),
    blockReason: workflow ? null : LTX_FILE_MISSING,
    workers,
    draft: draft ? { ...draft, ...(names ?? {}) } : null,
    jobs: jobs.map((j) => ({
      ...j,
      outcome: j.status,
      files: outputs.filter((o) => o.jobId === j.id),
    })),
  };
}

async function checkedForm(ctx: Ctx, form: LtxForm, opts: { requireMedia: boolean; requireWorker: boolean }) {
  const image = await media(ctx, form.imageFileId, 'IMAGE');
  const audio = await media(ctx, form.audioFileId, 'AUDIO');
  const worker = await workerOrNull(ctx, form.workerId);
  let projectTitle: string | null = null;
  if (form.projectId) {
    const found = rowsOf<{ id: string; title: string }>(
      await ctx.db.execute(sql`select id, title from creative_projects where id = ${form.projectId} and org_id = ${ctx.orgId} and deleted_at is null`),
    )[0];
    if (!found) throw badRequest('That project is not in this workspace.');
    projectTitle = found.title;
  }
  const audioLengthSec = audio?.durationMs != null ? audio.durationMs / 1000 : null;
  const result = validateLtxDraft(
    { ...form, audioLengthSec, expectedVramGb: worker?.expectedVramGb ?? null },
    opts,
  );
  return { image, audio, worker, audioLengthSec, projectTitle, ...result };
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
        projectTitle: checked.projectTitle,
        imageFileId: form.imageFileId,
        imageName: checked.image?.fileName ?? form.imageUploadName,
        audioFileId: form.audioFileId,
        audioName: checked.audio?.fileName ?? form.audioUploadName,
        audioStartSec: form.audioStartSec,
        durationSec: form.durationSec,
        width: form.width,
        height: form.height,
        fps: form.fps,
        loraName: form.loraName,
        loraStrength: form.loraStrength,
        upscaleWidth: form.upscaleWidth,
        upscaleHeight: form.upscaleHeight,
        wantUpscale: form.wantUpscale,
        imageUploadName: form.imageFileId ? null : form.imageUploadName,
        audioUploadName: form.audioFileId ? null : form.audioUploadName,
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
  loraName?: string;
  loraStrength?: number;
  upscaleWidth?: number;
  upscaleHeight?: number;
  wantUpscale?: boolean;
  imageUploadName?: string | null;
  audioUploadName?: string | null;
  filenamePrefix?: string;
  projectTitle?: string | null;
  progress?: { phase: string; value: number | null; max: number | null; detail: string };
  outputs?: { node: string; filename: string; subfolder: string; type: string }[];
  variantId?: string;
  assetId?: string;
  assetVersionId?: string;
}

interface ClaimedJob {
  id: string;
  orgId: string;
  promptId: string | null;
  projectId: string | null;
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

export async function listWorkerLoras(ctx: Ctx, workerId: string) {
  const worker = await workerOrNull(ctx, workerId);
  if (!worker) throw notFound('PC');
  let res: Response;
  try {
    res = await fetch(new URL('/models/loras', worker.baseUrl), { signal: AbortSignal.timeout(8_000) });
  } catch {
    throw badRequest('Creator OS could not reach that PC to list LoRA files.');
  }
  if (!res.ok) throw badRequest('That PC did not list its LoRA files.');
  const body = (await res.json()) as unknown;
  const loras = (Array.isArray(body) ? body : []).filter((name): name is string => typeof name === 'string' && !name.includes('/') && !name.includes('\\'));
  loras.sort((a, b) => a.localeCompare(b));
  return { loras };
}

const UPLOAD_EXT = {
  image: /\.(png|jpe?g|webp)$/i,
  audio: /\.(mp3|wav|flac|m4a|aac|ogg)$/i,
} as const;

/** Puts one image or audio file into that PC’s ComfyUI input folder. The original on any other machine is not touched. */
export async function uploadLtxInput(
  ctx: Ctx,
  workerId: string,
  kind: 'image' | 'audio',
  file: { bytes: Buffer; name: string; mime: string },
) {
  const worker = await workerOrNull(ctx, workerId);
  if (!worker) throw notFound('PC');
  if (file.bytes.byteLength > 250 * 1024 * 1024) throw badRequest('That file is over 250 MB, so it was not sent.');
  const base = (file.name.split(/[/\\]/).pop() || 'file').replace(/[^A-Za-z0-9._-]+/g, '_');
  if (!UPLOAD_EXT[kind].test(base)) {
    throw badRequest(kind === 'image' ? 'Upload a png, jpg, or webp image.' : 'Upload an mp3, wav, flac, m4a, aac, or ogg file.');
  }
  const name = await uploadToComfy(worker.baseUrl, { bytes: file.bytes, name: `cos_up_${base}`, mime: file.mime || 'application/octet-stream' });
  return { name, workerId: worker.id, label: worker.label };
}

/** Input names the installed RTX upscale node accepts. Null if that PC could not be asked. */
async function rtxUpscaleInputs(baseUrl: string): Promise<string[] | null> {
  try {
    const res = await fetch(new URL('/object_info/RTXVideoSuperResolution', baseUrl), {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      RTXVideoSuperResolution?: { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } };
    };
    const input = body.RTXVideoSuperResolution?.input;
    if (!input?.required) return null;
    return [...Object.keys(input.required), ...Object.keys(input.optional ?? {})];
  } catch {
    return null;
  }
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
      returning id, org_id as "orgId", prompt_id as "promptId", project_id as "projectId", settings, started_at as "startedAt"`),
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
    const imageName = settings.imageFileId
      ? await uploadToComfy(worker.baseUrl, await readUpload(await openAgentFile(db, env, claimed.orgId, String(settings.imageFileId)), claimed.id))
      : settings.imageUploadName;
    const audioName = settings.audioFileId
      ? await uploadToComfy(worker.baseUrl, await readUpload(await openAgentFile(db, env, claimed.orgId, String(settings.audioFileId)), claimed.id))
      : settings.audioUploadName;
    if (!imageName || !audioName) throw badRequest('The image or the song is no longer attached to this clip.');
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
      loraName: settings.loraName || 'mehaklora-ltx.safetensors',
      loraStrength: Number(settings.loraStrength),
      upscaleWidth: Number(settings.upscaleWidth ?? 1152),
      upscaleHeight: Number(settings.upscaleHeight ?? 2048),
      wantUpscale: settings.wantUpscale !== false,
      filenamePrefix: prefix,
      seed,
    });
    fitRtxUpscaleInputs(prompt, await rtxUpscaleInputs(worker.baseUrl));
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

type HistoryEntry = {
  outputs?: Record<string, { gifs?: HistoryOutput[]; videos?: HistoryOutput[]; images?: HistoryOutput[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
};

function videosFromHistory(entry: HistoryEntry) {
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
  const status = entry.status?.status_str;
  const completed =
    entry.status?.completed === true || status === 'success' || (outputs.length > 0 && status !== 'error');
  return { outputs, error: message?.[1]?.exception_message, status, completed };
}

/** Prefer /history/{id}. If that is empty right after finish, the full history list still has the prompt. */
async function loadHistoryEntry(
  baseUrl: string,
  promptId: string,
): Promise<{ entry: ReturnType<typeof videosFromHistory> | null; missing: boolean; unreachable: boolean }> {
  try {
    const res = await fetch(new URL(`/history/${promptId}`, baseUrl), { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const body = (await res.json()) as Record<string, HistoryEntry>;
      if (body[promptId]) return { entry: videosFromHistory(body[promptId]), missing: false, unreachable: false };
    }
  } catch {
    return { entry: null, missing: false, unreachable: true };
  }
  try {
    const res = await fetch(new URL('/history', baseUrl), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { entry: null, missing: true, unreachable: false };
    const body = (await res.json()) as Record<string, HistoryEntry>;
    if (body[promptId]) return { entry: videosFromHistory(body[promptId]), missing: false, unreachable: false };
    return { entry: null, missing: true, unreachable: false };
  } catch {
    return { entry: null, missing: false, unreachable: true };
  }
}

/** When the prompt id left the queue before history showed it, match the video by CreatorOS filename prefix. */
async function findHistoryByPrefix(
  baseUrl: string,
  prefix: string | null | undefined,
): Promise<ReturnType<typeof videosFromHistory> | null> {
  const key = (prefix ?? '').split('/').pop();
  if (!key || key.length < 6) return null;
  try {
    const res = await fetch(new URL('/history', baseUrl), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, HistoryEntry>;
    for (const raw of Object.values(body)) {
      const entry = videosFromHistory(raw);
      if (entry.outputs.some((o) => o.filename.includes(key))) return entry;
    }
  } catch {
    return null;
  }
  return null;
}

function variantFormatFor(contentFormat: string | null | undefined) {
  const f = (contentFormat ?? '').toUpperCase();
  if (f === 'SHORTS' || f === 'PERFORMANCE_REEL') return 'SHORTS';
  if (f === 'LYRIC_VIDEO') return 'LYRIC_VIDEO';
  if (f === 'TRAVEL_VLOG' || f === 'EDUCATION' || f === 'BEHIND_THE_SCENES') return 'LONG_FORM';
  return 'MASTER';
}

/** When a clip was generated for a Production project, create a publishing variant with that project’s name and attach the video when the library has it. */
async function attachLtxVariantToProject(db: Db, job: ClaimedJob) {
  if (!job.projectId) return;
  if (job.settings?.variantId) {
    await linkLtxVariantFile(db, job.orgId, job.id, job.settings.assetVersionId ?? null);
    return;
  }
  const [project] = rowsOf<{ title: string; brandId: string | null; contentFormat: string | null }>(
    await db.execute(sql`
      select title, brand_id as "brandId", content_format as "contentFormat"
      from creative_projects
      where id = ${job.projectId} and org_id = ${job.orgId} and deleted_at is null`),
  );
  if (!project) return;
  const [file] = rowsOf<{ fileId: string | null }>(
    await db.execute(sql`
      select file_instance_id as "fileId"
      from generation_outputs
      where job_id = ${job.id}
      order by case when output_role = 'upscale' then 0 else 1 end, created_at desc
      limit 1`),
  );
  const title = project.title.trim() || 'Untitled';
  const [asset] = await db
    .insert(logicalAssets)
    .values({
      orgId: job.orgId,
      title,
      kind: 'VIDEO',
      brandId: project.brandId,
      projectId: job.projectId,
      source: 'comfyui-ltx',
      creativeState: 'APPROVED',
    })
    .returning({ id: logicalAssets.id });
  const [version] = await db
    .insert(assetVersions)
    .values({
      orgId: job.orgId,
      assetId: asset!.id,
      label: 'LTX',
      number: 1,
      variantType: 'MASTER',
      isMaster: true,
      approvalState: 'APPROVED',
    })
    .returning({ id: assetVersions.id });
  if (file?.fileId) {
    await db
      .insert(assetFileLinks)
      .values({
        orgId: job.orgId,
        assetVersionId: version!.id,
        fileInstanceId: file.fileId,
        linkReason: 'comfyui-ltx',
        primaryPreference: true,
      })
      .onConflictDoNothing();
    await db.execute(sql`
      update generation_outputs
      set asset_version_id = ${version!.id}
      where job_id = ${job.id} and file_instance_id = ${file.fileId}`);
  }
  const [variant] = await db
    .insert(distributionVariants)
    .values({
      orgId: job.orgId,
      assetId: asset!.id,
      assetVersionId: version!.id,
      projectId: job.projectId,
      brandId: project.brandId,
      format: variantFormatFor(project.contentFormat),
      titleMaster: title,
      readiness: file?.fileId ? 'READY' : 'DRAFT',
    })
    .returning({ id: distributionVariants.id });
  await db.execute(sql`
    update logical_assets
    set selected_version_id = ${version!.id}, updated_at = now()
    where id = ${asset!.id}`);
  await db.execute(sql`
    update generation_jobs
    set settings = settings || ${JSON.stringify({
      variantId: variant!.id,
      assetId: asset!.id,
      assetVersionId: version!.id,
      projectTitle: title,
    })}::jsonb,
        updated_at = now()
    where id = ${job.id}`);
}

async function linkLtxVariantFile(db: Db, orgId: string, jobId: string, assetVersionId: string | null) {
  if (!assetVersionId) return;
  const [file] = rowsOf<{ fileId: string }>(
    await db.execute(sql`
      select file_instance_id as "fileId"
      from generation_outputs
      where job_id = ${jobId} and file_instance_id is not null
      order by case when output_role = 'upscale' then 0 else 1 end, created_at desc
      limit 1`),
  );
  if (!file?.fileId) return;
  await db
    .insert(assetFileLinks)
    .values({
      orgId,
      assetVersionId,
      fileInstanceId: file.fileId,
      linkReason: 'comfyui-ltx',
      primaryPreference: true,
    })
    .onConflictDoNothing();
  await db.execute(sql`
    update generation_outputs
    set asset_version_id = ${assetVersionId}
    where job_id = ${jobId} and file_instance_id = ${file.fileId}`);
  await db.execute(sql`
    update distribution_variants
    set readiness = 'READY', asset_version_id = ${assetVersionId}, updated_at = now()
    where asset_version_id = ${assetVersionId} or id = (
      select (settings->>'variantId')::uuid from generation_jobs where id = ${jobId}
    )`);
}

async function finishLtxSuccess(db: Db, job: ClaimedJob, outputs: NonNullable<LtxSettings['outputs']>) {
  const saved = rowsOf<{ id: string }>(
    await db.execute(sql`
      update generation_jobs
      set status = 'SUCCEEDED', finished_at = now(), updated_at = now(), error = null,
          settings = settings || ${JSON.stringify({ outputs })}::jsonb
      where id = ${job.id} and status in ('RUNNING', 'FAILED')
      returning id`),
  );
  if (!saved.length) return false;
  await db.execute(sql`delete from generation_outputs where job_id = ${job.id}`);
  for (const output of outputs) {
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
  try {
    await attachLtxVariantToProject(db, {
      ...job,
      settings: { ...job.settings, outputs },
    });
  } catch {
    // The video is saved; the publishing link can wait for the next scan pass.
  }
  return true;
}

async function applyHistoryResult(db: Db, job: ClaimedJob, entry: ReturnType<typeof videosFromHistory>, workerBaseUrl: string) {
  if (entry.status === 'error' || (entry.completed && entry.error && !entry.outputs.length)) {
    await failJob(db, job.id, entry.error || 'ComfyUI stopped this video.');
    return true;
  }
  if (!entry.completed) {
    await saveProgress(db, job.id, await readComfyProgress(workerBaseUrl, job.promptId!));
    return false;
  }
  if (!entry.outputs.length) {
    await failJob(db, job.id, 'ComfyUI finished, but no video file was saved.');
    return true;
  }
  return finishLtxSuccess(db, job, entry.outputs);
}

async function linkRecentLtxOutputs(db: Db) {
  await db.execute(sql`
    update generation_outputs o
    set file_instance_id = f.id
    from (
      select distinct on (org_id, file_name) id, org_id, file_name
      from file_instances
      where archived_at is null
      order by org_id, file_name, last_seen_at desc nulls last
    ) f
    where o.file_instance_id is null
      and o.expected_path is not null
      and o.created_at > now() - interval '14 days'
      and f.org_id = o.org_id
      and f.file_name = regexp_replace(o.expected_path, '^.*/', '')`);
  const pending = rowsOf<ClaimedJob>(
    await db.execute(sql`
      select id, org_id as "orgId", prompt_id as "promptId", project_id as "projectId", settings, started_at as "startedAt"
      from generation_jobs
      where provider = 'comfyui-ltx' and status = 'SUCCEEDED' and project_id is not null
        and finished_at > now() - interval '14 days'
        and (settings->>'variantId' is null or settings->>'assetVersionId' is not null)
      order by finished_at desc
      limit 20`),
  );
  for (const job of pending) {
    try {
      await attachLtxVariantToProject(db, job);
    } catch {
      // Next pass retries.
    }
  }
}

function progressNumbers(job: Record<string, unknown>): { value: number | null; max: number | null } {
  const nested = job.progress && typeof job.progress === 'object' ? (job.progress as Record<string, unknown>) : {};
  const value = [nested.value, nested.current, job.progress_value].find((n) => typeof n === 'number') as number | undefined;
  const max = [nested.max, nested.total, job.progress_max].find((n) => typeof n === 'number') as number | undefined;
  return { value: value ?? null, max: max ?? null };
}

async function readComfyProgress(baseUrl: string, promptId: string): Promise<LtxSettings['progress']> {
  let phase: 'waiting' | 'rendering' | null = null;
  let value: number | null = null;
  let max: number | null = null;
  try {
    const res = await fetch(new URL('/api/jobs', baseUrl), { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const body = (await res.json()) as { jobs?: Record<string, unknown>[] };
      const job = (body.jobs ?? []).find((row) => row.id === promptId || row.prompt_id === promptId);
      if (job) {
        const status = String(job.status ?? '');
        if (status === 'pending' || status === 'queued') phase = 'waiting';
        if (status === 'in_progress' || status === 'running' || status === 'executing') phase = 'rendering';
        const nums = progressNumbers(job);
        value = nums.value;
        max = nums.max;
      }
    }
  } catch {
    // The queue check below still says whether the PC has the clip.
  }
  if (!phase) {
    try {
      const res = await fetch(new URL('/queue', baseUrl), { signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const body = (await res.json()) as { queue_running?: unknown; queue_pending?: unknown };
        const running = JSON.stringify(body.queue_running ?? []).includes(promptId);
        const pending = JSON.stringify(body.queue_pending ?? []).includes(promptId);
        if (running) phase = 'rendering';
        else if (pending) phase = 'waiting';
      }
    } catch {
      return undefined;
    }
  }
  if (!phase) return undefined;
  const detail = phase === 'waiting' ? 'Waiting in that PC’s queue.' : 'Rendering on that PC.';
  return { phase, value, max, detail };
}

async function saveProgress(db: Db, id: string, progress: LtxSettings['progress']) {
  if (!progress) return;
  await db.execute(sql`
    update generation_jobs
    set settings = settings || ${JSON.stringify({ progress })}::jsonb, updated_at = now()
    where id = ${id} and status = 'RUNNING'`);
}

async function recoverFalseFailedLtx(db: Db) {
  const failed = rowsOf<ClaimedJob>(
    await db.execute(sql`
      select id, org_id as "orgId", prompt_id as "promptId", project_id as "projectId", settings, started_at as "startedAt"
      from generation_jobs
      where provider = 'comfyui-ltx' and status = 'FAILED'
        and prompt_id is not null
        and error = 'ComfyUI is no longer running this video.'
        and finished_at > now() - interval '2 days'
      order by finished_at desc
      limit 5`),
  );
  let recovered = 0;
  for (const job of failed) {
    if (!job.promptId) continue;
    const [worker] = await db
      .select()
      .from(gpuWorkers)
      .where(sql`${gpuWorkers.id} = ${job.settings?.workerId ?? null} and ${gpuWorkers.orgId} = ${job.orgId}`)
      .limit(1);
    if (!worker) continue;
    const loaded = await loadHistoryEntry(worker.baseUrl, job.promptId);
    let entry = loaded.entry;
    if (!entry?.completed || !entry.outputs.length) {
      entry = await findHistoryByPrefix(worker.baseUrl, job.settings?.filenamePrefix);
    }
    if (entry?.completed && entry.outputs.length && (await finishLtxSuccess(db, job, entry.outputs))) recovered += 1;
  }
  return recovered;
}

export async function pollRunningLtx(db: Db, env: ServiceEnv) {
  void env;
  await linkRecentLtxOutputs(db);
  const recovered = await recoverFalseFailedLtx(db);
  const running = rowsOf<ClaimedJob>(
    await db.execute(sql`
      select id, org_id as "orgId", prompt_id as "promptId", project_id as "projectId", settings, started_at as "startedAt"
      from generation_jobs
      where provider = 'comfyui-ltx' and status = 'RUNNING'
      order by started_at asc
      limit 10`),
  );
  let updated = recovered;
  for (const job of running) {
    if (!job.promptId) {
      const age = Date.now() - new Date(job.startedAt ?? 0).getTime();
      if (age > 3 * 60_000) await failJob(db, job.id, 'The video did not start. Press Generate again.');
      else await saveProgress(db, job.id, { phase: 'sending', value: null, max: null, detail: 'Sending the image and audio to the PC.' });
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
    const loaded = await loadHistoryEntry(worker.baseUrl, job.promptId);
    if (loaded.unreachable) continue;
    let entry = loaded.entry;
    if (!entry && loaded.missing) {
      entry = await findHistoryByPrefix(worker.baseUrl, job.settings?.filenamePrefix);
    }
    if (!entry) {
      const age = Date.now() - new Date(job.startedAt ?? 0).getTime();
      if (age < 2 * 60_000) {
        await saveProgress(db, job.id, await readComfyProgress(worker.baseUrl, job.promptId));
        continue;
      }
      let queued = false;
      try {
        const q = await fetch(new URL('/queue', worker.baseUrl), { signal: AbortSignal.timeout(10_000) });
        queued = q.ok && (await q.text()).includes(job.promptId);
      } catch {
        continue;
      }
      // Finished jobs leave the queue before history is visible. Wait longer, and keep looking.
      if (!queued && age > 45 * 60_000) await failJob(db, job.id, 'ComfyUI is no longer running this video.');
      else await saveProgress(db, job.id, await readComfyProgress(worker.baseUrl, job.promptId));
      continue;
    }
    if (await applyHistoryResult(db, job, entry, worker.baseUrl)) updated += 1;
  }
  return { checked: running.length, updated, recovered };
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
