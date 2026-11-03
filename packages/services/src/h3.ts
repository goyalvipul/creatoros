import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generationJobs,
  generationOutputs,
  gpuWorkers,
  h3Drafts,
  sql,
  type Db,
  type H3Continuity,
  type H3ImageDraft,
  type H3SegmentDraft,
  type H3TaskMode,
} from '@creatoros/db';
import { openAgentFile } from './agent-file';
import { audit } from './audit';
import { linkRecentGeneratedOutputs, machineQueue } from './comfy';
import { notifyGenerationReady } from './notifications';
import { AppError, badRequest, notFound, type Ctx, type ServiceEnv } from './types';

const PROVIDER = 'comfyui-h3';
const WORKFLOW = 'MINIMAX H3 Motion Context FINAL API.json';
const MISSING = `The MiniMax workflow ${WORKFLOW} is not in this install.`;
const FPS = 24;
const MAX_SEGMENTS = 8;
const MAX_SECONDS = 20;

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

export const H3_ASPECTS = [
  '9:16 (Portrait Widescreen)',
  '16:9 (Landscape Widescreen)',
  '1:1 (Square)',
  '3:4 (Portrait)',
  '4:3 (Landscape)',
  '2:3 (Portrait)',
  '3:2 (Landscape)',
] as const;

export interface H3Form {
  projectId: string | null;
  workerId: string | null;
  imageFileId: string | null;
  imageUploadName: string | null;
  imageUploadWorkerId: string | null;
  prompt: string;
  aspectRatio: string;
  megapixels: number;
  audioLocked: boolean;
  shareAudio: boolean;
  segments: H3SegmentDraft[];
}

type Graph = Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;

interface BuiltSegment {
  continuity: H3Continuity;
  taskMode: H3TaskMode;
  refImageSize?: 'max' | 'match';
  prompt: string;
  images: { name: string; shared: boolean }[];
  audioName: string | null;
  durationSec: number;
}

let cached: { path: string; mtimeMs: number; sha256: string; graph: Graph; prompt: string } | null = null;

function findFile(name: string): string | null {
  const candidates = [
    resolve(process.cwd(), 'docs/comfy', name),
    resolve(process.cwd(), 'packages/services/h3', name),
    resolve(process.cwd(), '../../docs/comfy', name),
    resolve(process.cwd(), '../../packages/services/h3', name),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function h3Workflow() {
  const path = findFile(WORKFLOW);
  if (!path) return null;
  const mtimeMs = statSync(path).mtimeMs;
  if (!cached || cached.path !== path || cached.mtimeMs !== mtimeMs) {
    const bytes = readFileSync(path);
    const graph = JSON.parse(bytes.toString('utf8')) as Graph;
    cached = { path, mtimeMs, sha256: createHash('sha256').update(bytes).digest('hex'), graph, prompt: defaultPrompt(graph) };
  }
  return cached;
}

function defaultPrompt(graph: Graph): string {
  const raw = graph['29']?.inputs?.track_data;
  if (typeof raw !== 'string') return '';
  try {
    const data = JSON.parse(raw) as { tracks?: { type?: string; segments?: { content?: { user_prompt?: string } }[] }[] };
    const task = data.tracks?.find((t) => t.type === 'task');
    return task?.segments?.[0]?.content?.user_prompt ?? '';
  } catch {
    return '';
  }
}

/** Clones the API graph, drops the unused song-trim branch, and writes a fresh project. */
export function buildH3Prompt(
  graph: Graph,
  input: { projectName: string; segments: BuiltSegment[]; seed: number; aspectRatio: string; megapixels: number; audioLocked: boolean },
) {
  const copy = structuredClone(graph) as Graph;
  delete copy['37'];
  delete copy['38'];
  const frames = input.segments.map((a) => Math.max(1, Math.round(a.durationSec * FPS)));
  let cursor = 0;
  const ranges = frames.map((count) => {
    const start = cursor;
    cursor += count;
    return { start, end: cursor };
  });
  const seenImages = new Set<string>();
  const taskSegments = input.segments.map((segment, i) => ({
    id: randomUUID(),
    start_frame: ranges[i]!.start,
    end_frame: ranges[i]!.end,
    color: 'var(--multitrack-task-bg)',
    content: {
      media_type: 'none',
      task_mode: segment.taskMode,
      continuity_mode: i === 0 ? 'shot' : segment.continuity,
      ref_image_size: segment.refImageSize === 'match' ? 'match' : 'max',
      images: segment.images.map((image) => {
        const again = image.shared && seenImages.has(image.name);
        if (image.shared) seenImages.add(image.name);
        return {
          id: randomUUID(),
          source_type: 'input',
          file_path: image.name,
          file_name: image.name,
          shared_reference: image.shared,
          ...(again ? { shared_reference_copy: true } : {}),
        };
      }),
      muted: false,
      volume_db: 0,
      user_prompt: segment.prompt,
    },
  }));
  const audioSegments = input.segments.flatMap((segment, i) => {
    if (!segment.audioName) return [];
    return [{
      id: randomUUID(),
      start_frame: ranges[i]!.start,
      end_frame: ranges[i]!.end,
      color: 'var(--highlight)',
      content: {
        media_type: 'audio',
        source_type: 'input',
        file_path: segment.audioName,
        file_name: segment.audioName,
        muted: false,
        volume_db: 0,
        duration: segment.durationSec,
        shared_reference: false,
      },
    }];
  });
  const audioLocked = input.audioLocked && input.segments.every((segment) => !!segment.audioName);
  const editor = copy['29'];
  const previous = JSON.parse(String(editor?.inputs?.track_data ?? '{}')) as {
    tracks?: { id?: string; name?: string; type?: string; color?: string; muted?: boolean; solo?: boolean; volume_db?: number; locked?: boolean; audio_locked?: boolean }[];
  };
  const tracks = (previous.tracks ?? []).map((track) => {
    if (track.type === 'task') return { ...track, segments: taskSegments };
    if (track.type === 'audio') return { ...track, segments: audioSegments, audio_locked: audioLocked };
    if (track.type === 'video') return { ...track, segments: [] };
    return track;
  });
  if (editor?.inputs) {
    editor.inputs.resolution = 'width x height (megapixels)';
    editor.inputs['resolution.aspect_ratio'] = input.aspectRatio;
    editor.inputs['resolution.megapixels'] = input.megapixels;
    editor.inputs.format = 'MiniMax';
    editor.inputs.track_data = JSON.stringify({
      ...previous,
      tracks,
      total_length: cursor,
      frame_rate: FPS,
    });
  }
  const project = copy['15'];
  if (project?.inputs) {
    project.inputs.project_name = input.projectName;
    project.inputs.seed = input.seed;
  }
  const combine = copy['17'];
  if (combine?.inputs) {
    combine.inputs.project_data = JSON.stringify({
      project_name: input.projectName,
      width: 768,
      height: 1376,
      frame_rate: FPS,
      clips: [],
      auto_combine: true,
      updated_at: Date.now() / 1000,
    });
  }
  const save = copy['25'];
  if (save?.inputs) {
    save.inputs['input_mode.video'] = ['17', 0];
  }
  return copy;
}

export async function getH3Studio(ctx: Ctx) {
  const workflow = h3Workflow();
  const listed = rowsOf<{ id: string; label: string; baseUrl: string; role: string; expectedVramGb: number | null; enabled: boolean }>(
    await ctx.db.execute(sql`
      select id, label, base_url as "baseUrl", role, expected_vram_gb as "expectedVramGb", enabled
      from gpu_workers where org_id = ${ctx.orgId} and enabled
      order by case when role = 'primary' then 0 else 1 end, label`),
  );
  const workers = await Promise.all(listed.map(async (worker) => ({ ...worker, queue: await machineQueue(ctx.db, ctx.orgId, worker) })));
  const [draft] = await ctx.db.select().from(h3Drafts).where(sql`${h3Drafts.orgId} = ${ctx.orgId}`).limit(1);
  const imageName = draft?.imageFileId
    ? rowsOf<{ fileName: string }>(
        await ctx.db.execute(sql`select file_name as "fileName" from file_instances where id = ${draft.imageFileId} and org_id = ${ctx.orgId}`),
      )[0]?.fileName ?? null
    : null;
  const jobs = await listH3Jobs(ctx.db, ctx.orgId);
  const fallbackImage: H3ImageDraft | null = draft?.imageFileId || draft?.imageUploadName
    ? { fileId: draft.imageFileId, uploadName: draft.imageUploadName, uploadWorkerId: draft.imageUploadWorkerId, shared: false }
    : null;
  const segments = await labelSegments(ctx, normalizeSegments(draft?.segments, draft?.prompt ?? '', fallbackImage));
  return {
    ready: workflow != null,
    blockReason: workflow ? null : MISSING,
    defaults: { prompt: workflow?.prompt ?? '' },
    workers,
    draft: draft ? { ...draft, imageName, segments } : null,
    jobs,
  };
}

async function labelSegments(ctx: Ctx, segments: H3SegmentDraft[]) {
  const ids = [...new Set(segments.flatMap((s) => [s.audioFileId, ...s.images.map((image) => image.fileId)]).filter((id): id is string => !!id))];
  const rows = ids.length
    ? rowsOf<{ id: string; fileName: string }>(
        await ctx.db.execute(sql`
          select id, file_name as "fileName" from file_instances
          where org_id = ${ctx.orgId} and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`),
      )
    : [];
  const byId = new Map(rows.map((row) => [row.id, row.fileName]));
  return segments.map((segment) => ({
    ...segment,
    audioName: (segment.audioFileId && byId.get(segment.audioFileId)) || segment.audioUploadName,
    images: segment.images.map((image) => ({
      ...image,
      name: (image.fileId && byId.get(image.fileId)) || image.uploadName,
    })),
  }));
}

async function listH3Jobs(db: Db, orgId: string) {
  const jobs = rowsOf<{
    id: string;
    status: string;
    error: string | null;
    createdAt: Date;
    projectId: string | null;
    projectTitle: string | null;
    settings: Record<string, unknown>;
  }>(
    await db.execute(sql`
      select j.id, j.status, j.error, j.created_at as "createdAt", j.project_id as "projectId",
             coalesce(p.title, j.settings->>'projectTitle') as "projectTitle", j.settings
      from generation_jobs j
      left join creative_projects p on p.id = j.project_id and p.org_id = j.org_id and p.deleted_at is null
      where j.org_id = ${orgId} and j.provider = ${PROVIDER}
      order by j.created_at desc
      limit 20`),
  );
  const outputs = jobs.length
    ? rowsOf<{ jobId: string; fileId: string | null; fileName: string | null; expectedPath: string | null }>(
        await db.execute(sql`
          select o.job_id as "jobId", o.file_instance_id as "fileId", o.expected_path as "expectedPath", f.file_name as "fileName"
          from generation_outputs o
          left join file_instances f on f.id = o.file_instance_id
          where o.org_id = ${orgId} and o.job_id in (${sql.join(jobs.map((j) => sql`${j.id}::uuid`), sql`, `)})`),
      )
    : [];
  return jobs.map((j) => ({ ...j, files: outputs.filter((o) => o.jobId === j.id) }));
}

export async function saveH3Draft(ctx: Ctx, form: H3Form) {
  const now = ctx.now();
  const values = {
    projectId: form.projectId,
    workerId: form.workerId,
    imageFileId: form.imageFileId,
    imageUploadName: form.imageUploadName,
    imageUploadWorkerId: form.imageUploadWorkerId,
    prompt: form.prompt,
    aspectRatio: form.aspectRatio,
    megapixels: form.megapixels,
    audioLocked: form.audioLocked,
    shareAudio: form.shareAudio,
    segments: form.segments.slice(0, MAX_SEGMENTS),
    updatedBy: ctx.userId,
    updatedAt: now,
  };
  const [row] = await ctx.db
    .insert(h3Drafts)
    .values({ orgId: ctx.orgId, ...values })
    .onConflictDoUpdate({ target: h3Drafts.orgId, set: values })
    .returning();
  return { draft: row! };
}

const CONTINUITY = new Set<H3Continuity>(['shot', 'context', 'context_swap']);
const TASK_MODE = new Set<H3TaskMode>(['i2v', 'ref', 'v2v', 'l2v']);

function normalizeSegments(raw: unknown, fallbackPrompt: string, fallbackImage: H3ImageDraft | null): H3SegmentDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    const row = (item ?? {}) as Partial<H3SegmentDraft>;
    const images = (Array.isArray(row.images) && row.images.length ? row.images : fallbackImage ? [fallbackImage] : []).map((image) => ({
      ...image,
      shared: image.shared === true,
    }));
    const continuity = CONTINUITY.has(row.continuity as H3Continuity) ? (row.continuity as H3Continuity) : i === 0 ? 'shot' : 'context';
    const taskMode = TASK_MODE.has(row.taskMode as H3TaskMode) ? (row.taskMode as H3TaskMode) : 'ref';
    return {
      continuity: i === 0 ? 'shot' : continuity,
      taskMode,
      refImageSize: row.refImageSize === 'match' ? 'match' : 'max',
      prompt: typeof row.prompt === 'string' && row.prompt.trim() ? row.prompt : fallbackPrompt,
      audioFileId: row.audioFileId ?? null,
      audioUploadName: row.audioUploadName ?? null,
      audioUploadWorkerId: row.audioUploadWorkerId ?? null,
      durationSec: typeof row.durationSec === 'number' ? row.durationSec : null,
      images,
    };
  });
}

function checkForm(form: H3Form) {
  if (!form.workerId) throw badRequest('Choose the PC first.');
  if (!H3_ASPECTS.includes(form.aspectRatio as (typeof H3_ASPECTS)[number])) throw badRequest('Choose a resolution from the list.');
  if (![0.5, 1, 1.5].includes(form.megapixels)) throw badRequest('Choose 0.5, 1, or 1.5 megapixels.');
  if (!form.segments.length) throw badRequest('Add a segment.');
  if (form.segments.length > MAX_SEGMENTS) throw badRequest(`The timeline can take at most ${MAX_SEGMENTS} segments.`);
  form.segments.forEach((segment, i) => {
    if (!segment.prompt.trim()) throw badRequest(`Write the prompt for segment ${i + 1}.`);
    if (!segment.images.some((image) => image.fileId || image.uploadName)) throw badRequest(`Add a picture on segment ${i + 1}.`);
    if (!TASK_MODE.has(segment.taskMode)) throw badRequest(`Segment ${i + 1} has an unknown mode.`);
    if (!CONTINUITY.has(segment.continuity)) throw badRequest(`Segment ${i + 1} has an unknown join.`);
    if (segment.durationSec != null && (segment.durationSec <= 0 || segment.durationSec > MAX_SECONDS)) {
      throw badRequest(`Segment ${i + 1} must be between 0 and ${MAX_SECONDS} seconds.`);
    }
  });
}

export async function generateH3(ctx: Ctx, form: H3Form) {
  if (!h3Workflow()) throw badRequest(MISSING);
  checkForm(form);
  if (form.projectId) {
    const found = rowsOf<{ id: string }>(
      await ctx.db.execute(sql`select id from creative_projects where id = ${form.projectId} and org_id = ${ctx.orgId} and deleted_at is null`),
    )[0];
    if (!found) throw badRequest('That project is not in this workspace.');
  }
  await saveH3Draft(ctx, form);
  const [worker] = await ctx.db
    .select()
    .from(gpuWorkers)
    .where(sql`${gpuWorkers.id} = ${form.workerId} and ${gpuWorkers.orgId} = ${ctx.orgId}`)
    .limit(1);
  if (!worker?.enabled) throw badRequest('That PC is not in the list.');
  const [job] = await ctx.db
    .insert(generationJobs)
    .values({
      orgId: ctx.orgId,
      projectId: form.projectId,
      provider: PROVIDER,
      status: 'QUEUED',
      settings: {
        workerId: worker.id,
        workerLabel: worker.label,
        imageFileId: form.imageFileId,
        imageUploadName: form.imageUploadName,
        prompt: form.prompt,
        aspectRatio: form.aspectRatio,
        megapixels: form.megapixels,
        audioLocked: form.audioLocked,
        segments: form.segments,
      },
      workflow: { format: 'api', source: WORKFLOW, sha256: h3Workflow()!.sha256 },
    })
    .returning();
  await audit(ctx, 'comfy.h3.generate', { type: 'generation_job', id: job!.id }, undefined, { workerLabel: worker.label });
  return { job: { id: job!.id, status: 'QUEUED' as const } };
}

async function uploadBytes(origin: string, file: { bytes: Buffer; name: string; mime: string }) {
  const form = new FormData();
  form.append('image', new Blob([Uint8Array.from(file.bytes)], { type: file.mime }), file.name);
  form.append('overwrite', 'true');
  form.append('type', 'input');
  const res = await fetch(new URL('/upload/image', origin), { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw badRequest(`ComfyUI refused the file (${res.status}).`);
  const body = (await res.json()) as { name?: string; subfolder?: string };
  if (!body.name) throw badRequest('ComfyUI did not accept the file.');
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

async function readStream(body: ReadableStream<Uint8Array>, name: string, mime: string, jobId: string, label: string) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > 80 * 1024 * 1024) throw badRequest(`${label} is over 80 MB, so it was not sent.`);
    chunks.push(next.value);
  }
  const base = (name.split(/[/\\]/).pop() || 'file').replace(/[^A-Za-z0-9._-]+/g, '_');
  return { bytes: Buffer.concat(chunks), name: `cos_${jobId.slice(0, 8)}_${base}`, mime: mime || 'application/octet-stream' };
}

async function durationOf(db: Db, orgId: string, fileId: string | null, given: number | null) {
  if (given != null && given > 0) return given;
  if (!fileId) return null;
  const row = rowsOf<{ durationMs: number | null }>(
    await db.execute(sql`
      select nullif(tech->>'durationMs', '')::float8 as "durationMs"
      from file_instances where id = ${fileId} and org_id = ${orgId}`),
  )[0];
  if (row?.durationMs && row.durationMs > 0) return row.durationMs / 1000;
  return null;
}

interface H3Job {
  id: string;
  orgId: string;
  promptId: string | null;
  settings: {
    workerId?: string;
    imageFileId?: string | null;
    imageUploadName?: string | null;
    prompt?: string;
    aspectRatio?: string;
    megapixels?: number;
    audioLocked?: boolean;
    segments?: H3SegmentDraft[];
    filenamePrefix?: string;
    progress?: { phase: string; detail: string };
    outputs?: { node: string; filename: string; subfolder: string; type: string }[];
  };
  startedAt: Date | null;
}

async function failJob(db: Db, id: string, message: string) {
  await db.execute(sql`
    update generation_jobs
    set status = 'FAILED', error = ${message.slice(0, 2000)}, finished_at = now(), updated_at = now()
    where id = ${id} and status in ('QUEUED', 'RUNNING')`);
}

export async function submitH3Job(db: Db, env: ServiceEnv, jobId: string) {
  const claimed = rowsOf<H3Job>(
    await db.execute(sql`
      update generation_jobs
      set status = 'RUNNING', started_at = now(), updated_at = now(), error = null
      where id = ${jobId} and provider = ${PROVIDER} and status = 'QUEUED'
      returning id, org_id as "orgId", prompt_id as "promptId", settings, started_at as "startedAt"`),
  )[0];
  if (!claimed) return { skipped: true };
  try {
    const workflow = h3Workflow();
    if (!workflow) throw badRequest(MISSING);
    const settings = claimed.settings ?? {};
    const [worker] = await db
      .select()
      .from(gpuWorkers)
      .where(sql`${gpuWorkers.id} = ${settings.workerId ?? null} and ${gpuWorkers.orgId} = ${claimed.orgId}`)
      .limit(1);
    if (!worker?.enabled) throw badRequest('The PC for this job is no longer in the list.');
    const segments = settings.segments ?? [];
    const names = new Map<string, string>();
    const place = async (fileId: string | null | undefined, uploadName: string | null | undefined, label: string) => {
      const key = fileId ? `file:${fileId}` : uploadName ? `upload:${uploadName}` : '';
      if (!key) return null;
      const cached = names.get(key);
      if (cached) return cached;
      let stored = uploadName ?? null;
      if (fileId) {
        const opened = await openAgentFile(db, env, claimed.orgId, fileId);
        stored = await uploadBytes(worker.baseUrl, await readStream(opened.body, opened.name, opened.mime, `${claimed.id}-${names.size}`, label));
      }
      if (stored) names.set(key, stored);
      return stored;
    };
    const built: BuiltSegment[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const imageNames: { name: string; shared: boolean }[] = [];
      for (const image of segment.images ?? []) {
        const name = await place(image.fileId, image.uploadName, `Segment ${i + 1} picture`);
        if (name) imageNames.push({ name, shared: image.shared === true });
      }
      if (!imageNames.length) throw badRequest(`Segment ${i + 1} has no picture.`);
      const audioName = await place(segment.audioFileId, segment.audioUploadName, `Segment ${i + 1} audio`);
      const durationSec = await durationOf(db, claimed.orgId, segment.audioFileId, segment.durationSec);
      if (durationSec == null) throw badRequest(`Enter how many seconds segment ${i + 1} is. Its length was not scanned.`);
      if (durationSec > MAX_SECONDS) throw badRequest(`Segment ${i + 1} is longer than ${MAX_SECONDS} seconds.`);
      built.push({
        continuity: segment.continuity,
        taskMode: segment.taskMode,
        refImageSize: segment.refImageSize === 'match' ? 'match' : 'max',
        prompt: segment.prompt,
        images: imageNames,
        audioName,
        durationSec,
      });
    }
    const projectName = `cos${claimed.id.replace(/-/g, '').slice(0, 12)}`;
    const seed = Math.floor(Math.random() * 1_000_000_000_000_000);
    const prompt = buildH3Prompt(workflow.graph, {
      projectName,
      segments: built,
      seed,
      aspectRatio: settings.aspectRatio || '9:16 (Portrait Widescreen)',
      megapixels: settings.megapixels || 1,
      audioLocked: settings.audioLocked !== false,
    });
    const res = await fetch(new URL('/prompt', worker.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      prompt_id?: string;
      node_errors?: Record<string, unknown>;
      error?: { message?: string };
    };
    const nodeError = body.node_errors ? Object.entries(body.node_errors)[0] : null;
    const rejected = nodeError
      ? `ComfyUI rejected node ${nodeError[0]}. ${JSON.stringify(nodeError[1]).slice(0, 500)}`
      : body.error?.message;
    if (!res.ok || rejected || !body.prompt_id) throw badRequest(rejected || `ComfyUI did not start the video (${res.status}).`);
    await db.execute(sql`
      update generation_jobs
      set prompt_id = ${body.prompt_id}, external_job_id = ${body.prompt_id},
          settings = settings || ${JSON.stringify({ projectName, seed })}::jsonb,
          updated_at = now()
      where id = ${claimed.id}`);
    return { promptId: body.prompt_id };
  } catch (e) {
    const message = e instanceof AppError ? e.message : e instanceof Error ? e.message : 'The video did not start.';
    await failJob(db, claimed.id, message);
    return { failed: message };
  }
}

export async function submitQueuedH3(db: Db, env: ServiceEnv) {
  const waiting = rowsOf<{ id: string }>(
    await db.execute(sql`
      select id from generation_jobs
      where provider = ${PROVIDER} and status = 'QUEUED'
      order by created_at asc
      limit 1`),
  );
  const out = [];
  for (const job of waiting) out.push(await submitH3Job(db, env, job.id));
  return out;
}

type HistoryEntry = {
  outputs?: Record<string, Record<string, unknown>>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
};

function videosFromHistory(entry: HistoryEntry) {
  const message = (entry.status?.messages ?? []).find((m) => Array.isArray(m) && m[0] === 'execution_error') as
    | [string, { exception_message?: string }]
    | undefined;
  const outputs: NonNullable<H3Job['settings']['outputs']> = [];
  for (const [node, out] of Object.entries(entry.outputs ?? {})) {
    for (const value of Object.values(out ?? {})) {
      const files = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
      for (const file of files) {
        const row = file as { filename?: string; subfolder?: string; type?: string };
        if (!row.filename || !/\.(mp4|webm|mkv|mov)$/i.test(row.filename)) continue;
        outputs.push({ node, filename: row.filename, subfolder: row.subfolder ?? '', type: row.type ?? 'output' });
      }
    }
  }
  const status = entry.status?.status_str;
  const completed = entry.status?.completed === true || status === 'success' || (outputs.length > 0 && status !== 'error');
  return { outputs, error: message?.[1]?.exception_message, status, completed };
}

async function loadHistory(baseUrl: string, promptId: string) {
  try {
    const res = await fetch(new URL(`/history/${promptId}`, baseUrl), { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const body = (await res.json()) as Record<string, HistoryEntry>;
      if (body[promptId]) return videosFromHistory(body[promptId]);
    }
  } catch {
    return null;
  }
  try {
    const res = await fetch(new URL('/history', baseUrl), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, HistoryEntry>;
    if (body[promptId]) return videosFromHistory(body[promptId]);
    return undefined;
  } catch {
    return null;
  }
}

async function stillQueued(baseUrl: string, promptId: string) {
  try {
    const res = await fetch(new URL('/queue', baseUrl), { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { queue_running?: unknown; queue_pending?: unknown };
    const text = JSON.stringify(body.queue_running ?? []) + JSON.stringify(body.queue_pending ?? []);
    return text.includes(promptId);
  } catch {
    return true;
  }
}

export async function pollRunningH3(db: Db, env: ServiceEnv) {
  void env;
  const running = rowsOf<H3Job>(
    await db.execute(sql`
      select id, org_id as "orgId", prompt_id as "promptId", settings, started_at as "startedAt"
      from generation_jobs
      where provider = ${PROVIDER} and status = 'RUNNING'
      order by started_at asc
      limit 3`),
  );
  let updated = 0;
  for (const job of running) {
    const age = Date.now() - new Date(job.startedAt ?? 0).getTime();
    if (!job.promptId) {
      if (age > 3 * 60_000) await failJob(db, job.id, 'The video did not start. Press Generate again.');
      else
        await db.execute(sql`
          update generation_jobs
          set settings = settings || ${JSON.stringify({ progress: { phase: 'sending', detail: 'Sending the picture and audio to the PC.' } })}::jsonb,
              updated_at = now()
          where id = ${job.id}`);
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
    const entry = await loadHistory(worker.baseUrl, job.promptId);
    if (entry === null) continue;
    if (!entry) {
      const queued = await stillQueued(worker.baseUrl, job.promptId);
      if (age > 3 * 60 * 60_000) await failJob(db, job.id, 'This video has been running for over three hours.');
      else
        await db.execute(sql`
          update generation_jobs
          set settings = settings || ${JSON.stringify({ progress: { phase: 'rendering', detail: queued ? 'Rendering on that PC.' : 'Waiting for the finished video.' } })}::jsonb,
              updated_at = now()
          where id = ${job.id}`);
      continue;
    }
    if (entry.status === 'error' || (entry.completed && entry.error && !entry.outputs.length)) {
      await failJob(db, job.id, entry.error || 'ComfyUI stopped this video.');
      updated += 1;
      continue;
    }
    if (entry.completed && !entry.outputs.length) {
      await failJob(db, job.id, 'ComfyUI finished, but no video file was saved.');
      updated += 1;
      continue;
    }
    if (!entry.completed || !entry.outputs.length) continue;
    const saved = rowsOf<{ id: string }>(
      await db.execute(sql`
        update generation_jobs
        set status = 'SUCCEEDED', finished_at = now(), updated_at = now(), error = null,
            settings = settings || ${JSON.stringify({ outputs: entry.outputs, progress: { phase: 'done', detail: 'Video is ready.' } })}::jsonb
        where id = ${job.id} and status = 'RUNNING'
        returning id`),
    );
    if (!saved.length) continue;
    await notifyGenerationReady(db, { id: job.id, orgId: job.orgId, provider: PROVIDER, settings: job.settings }).catch(
      () => undefined,
    );
    await db.execute(sql`delete from generation_outputs where job_id = ${job.id}`);
    const ordered = [
      ...entry.outputs.filter((o) => o.node === '25'),
      ...entry.outputs.filter((o) => o.node !== '25'),
    ];
    for (const output of ordered) {
      await db.insert(generationOutputs).values({
        orgId: job.orgId,
        jobId: job.id,
        node: output.node,
        outputRole: output.node === '25' ? 'final' : 'segment',
        expectedPath: output.subfolder ? `${output.subfolder}/${output.filename}` : output.filename,
      });
    }
    updated += 1;
  }
  await linkRecentGeneratedOutputs(db).catch(() => undefined);
  return { checked: running.length, updated };
}
