import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generationJobs, generationOutputs, gpuWorkers, qwenDrafts, sql, type Db } from '@creatoros/db';
import { openAgentFile } from './agent-file';
import { attachJobToProject, fileForWorker } from './comfy';
import { notifyGenerationReady } from './notifications';
import { audit } from './audit';
import { AppError, badRequest, notFound, type Ctx, type ServiceEnv } from './types';

const PROVIDER = 'comfyui-qwen-tts';
const WORKFLOW = 'Mehak_Qwen3_External_VoiceClone-2API.json';
const BUILTIN = 'mehakdeepvoice.wav';
const MISSING = `The voice workflow ${WORKFLOW} is not in this install.`;

const MEHAK_DEEP_TEXT =
  "Never. What we're trying to do here, it's bigger than just me and Amisha. And she agrees. We came here for information and the last person to have that information was in the city.So, no, I'm not a person who runs. What happened there? I feel bad you couldn't help Anna, don't you? That poor woman looked you in the eyes, confused, petrified, broken, and you couldn't do anything. But hey, who do you think's more responsible?";

const MEHAK_NORMAL_TEXT =
  "Here are three ways to get what you want by using the same vocal techniques I use as a voice actor. So, I'm a full-time voice actor and my job is literally to make people feel things with my voice, whether that's trust, excitement, urgency, comfort, power, or literally anything else you can think of. And you can use the same techniques I do in my job in your everyday life. Because what most people don't realize is what kind of voice you have actually matters 0%. It's what you do with your voice that makes a message effective. your tone, pace, and even the pitch of your voice triggers psychological responses. We're wired to respond emotionally even before we process the words. Okay, so we're going to start with what to do if you want to be taken seriously. People perceive lower voices as more confident and trustworthy because we associate a lower pitch with authority. So, if you want to be taken seriously, like in a negotiation or conflict, drop your pitch just slightly and speak from your diaphragm. Here's an example in voice over. Leadership isn't about volume. It's about vision, clarity, and calm conviction. In real life, it might sound like this. We won't be entertaining offers any lower than 2.5. Now, if you want to sound like you're in control, speak at a slower pace. Fast talkers sound nervous. Slow your speech by 10 to 15% and you'll come across as more thoughtful, more powerful, and way more in control. So, for example, in voice acting, that might sound like, \"The onboarding process is simple. Your dashboard is intuitive and everything you need is right at your fingertips.\" And in real life, you might say something like, \"I understand the way you're feeling, and we can talk about this later.\" But if you want to ask for a favor or you're trying to deescalate tension, warmth and vocal smile actually matter more than confidence. Add just a touch of softness and upward inflection and you're good to go. In voice acting, you might hear it in something like this. Hey, I totally get it. Things have been a lot lately. But if you've been considering donating to the Dyslexic Dalmatian Foundation, this might be your sign. And in real life, you might say something like, \"Thank you so much for all of your hard work. Can you come to our next event, too?\" And you don't have to be a provoice actor to do this. You just have to be intentional. And if you're already doing this naturally, you're actually using performance psychology.";

export const QWEN_CLIPS = [
  { file: 'mehakdeepvoice.wav', label: 'mehakdeepvoice.wav' },
  { file: 'MehakDeep.wav', label: 'MehakDeep.wav' },
  { file: 'MehakNormal.wav', label: 'MehakNormal.wav' },
] as const;

export type QwenClipFile = (typeof QWEN_CLIPS)[number]['file'];

const CLIP_TEXT: Partial<Record<QwenClipFile, string>> = {
  'MehakDeep.wav': MEHAK_DEEP_TEXT,
  'MehakNormal.wav': MEHAK_NORMAL_TEXT,
};

function isClip(file: string): file is QwenClipFile {
  return QWEN_CLIPS.some((clip) => clip.file === file);
}

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

export interface QwenForm {
  projectId?: string | null;
  workerId: string | null;
  audioFileId: string | null;
  audioUploadName: string | null;
  audioUploadWorkerId: string | null;
  useBuiltin: boolean;
  builtinClip: QwenClipFile;
  referenceText: string;
  targetText: string;
}

type Graph = Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;

let cached: { path: string; mtimeMs: number; sha256: string; graph: Graph; referenceText: string; targetText: string } | null = null;

function findFile(name: string): string | null {
  const candidates = [
    resolve(process.cwd(), 'docs/comfy', name),
    resolve(process.cwd(), 'packages/services/qwen', name),
    resolve(process.cwd(), '../../docs/comfy', name),
    resolve(process.cwd(), '../../packages/services/qwen', name),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function qwenWorkflow() {
  const path = findFile(WORKFLOW);
  if (!path) return null;
  const mtimeMs = statSync(path).mtimeMs;
  if (!cached || cached.path !== path || cached.mtimeMs !== mtimeMs) {
    const bytes = readFileSync(path);
    const graph = JSON.parse(bytes.toString('utf8')) as Graph;
    const node = Object.values(graph).find((n) => n.class_type === 'Qwen3ExternalVoiceClone');
    cached = {
      path,
      mtimeMs,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      graph,
      referenceText: String(node?.inputs?.reference_text ?? ''),
      targetText: String(node?.inputs?.target_text ?? ''),
    };
  }
  return cached;
}

function builtinWav(file = BUILTIN): string | null {
  return isClip(file) ? findFile(file) : null;
}

export async function getQwenStudio(ctx: Ctx) {
  const workflow = qwenWorkflow();
  const workers = rowsOf<{ id: string; label: string; baseUrl: string; role: string; expectedVramGb: number | null; enabled: boolean }>(
    await ctx.db.execute(sql`
      select id, label, base_url as "baseUrl", role, expected_vram_gb as "expectedVramGb", enabled
      from gpu_workers where org_id = ${ctx.orgId} and enabled
      order by case when role = 'primary' then 0 else 1 end, label`),
  );
  const [draft] = await ctx.db.select().from(qwenDrafts).where(sql`${qwenDrafts.orgId} = ${ctx.orgId}`).limit(1);
  const audioName = draft?.audioFileId
    ? rowsOf<{ fileName: string }>(
        await ctx.db.execute(sql`select file_name as "fileName" from file_instances where id = ${draft.audioFileId} and org_id = ${ctx.orgId}`),
      )[0]?.fileName ?? null
    : null;
  const jobs = await listQwenJobs(ctx.db, ctx.orgId);
  return {
    ready: workflow != null && builtinWav() != null,
    blockReason: workflow ? (builtinWav() ? null : `The reference clip ${BUILTIN} is not in this install.`) : MISSING,
    defaults: {
      referenceText: workflow?.referenceText ?? '',
      targetText: workflow?.targetText ?? '',
      builtinName: BUILTIN,
      clips: QWEN_CLIPS.map((clip) => ({
        file: clip.file,
        label: clip.label,
        referenceText: CLIP_TEXT[clip.file] ?? workflow?.referenceText ?? '',
      })),
    },
    workers,
    draft: draft ? { ...draft, audioName } : null,
    jobs,
  };
}

async function listQwenJobs(db: Db, orgId: string) {
  const jobs = rowsOf<{
    id: string;
    status: string;
    error: string | null;
    createdAt: Date;
    settings: Record<string, unknown>;
  }>(
    await db.execute(sql`
      select id, status, error, created_at as "createdAt", settings
      from generation_jobs
      where org_id = ${orgId} and provider = ${PROVIDER}
      order by created_at desc
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

export async function saveQwenDraft(ctx: Ctx, form: QwenForm) {
  const now = ctx.now();
  const values = {
    projectId: form.projectId ?? null,
    workerId: form.workerId,
    audioFileId: form.useBuiltin ? null : form.audioFileId,
    audioUploadName: form.useBuiltin ? null : form.audioUploadName,
    audioUploadWorkerId: form.useBuiltin ? null : form.audioUploadWorkerId,
    useBuiltin: form.useBuiltin,
    builtinClip: isClip(form.builtinClip) ? form.builtinClip : BUILTIN,
    referenceText: form.referenceText,
    targetText: form.targetText,
    updatedBy: ctx.userId,
    updatedAt: now,
  };
  const [row] = await ctx.db
    .insert(qwenDrafts)
    .values({ orgId: ctx.orgId, ...values })
    .onConflictDoUpdate({ target: qwenDrafts.orgId, set: values })
    .returning();
  return { draft: row! };
}

function checkForm(form: QwenForm) {
  if (!form.workerId) throw badRequest('Choose the PC first.');
  if (!form.referenceText.trim()) throw badRequest('Paste the words spoken in the reference audio.');
  if (!form.targetText.trim()) throw badRequest('Write the line you want spoken.');
  if (!form.useBuiltin && !form.audioFileId && !form.audioUploadName) throw badRequest('Choose a reference audio, or use the built-in Mehak clip.');
  if (form.useBuiltin && !isClip(form.builtinClip)) throw badRequest('Choose a reference clip from the list.');
  if (form.useBuiltin && !builtinWav(form.builtinClip)) throw badRequest(`The clip ${form.builtinClip} is not in this install.`);
}

export async function generateQwen(ctx: Ctx, form: QwenForm) {
  if (!qwenWorkflow()) throw badRequest(MISSING);
  checkForm(form);
  if (form.projectId) {
    const found = rowsOf<{ id: string }>(
      await ctx.db.execute(sql`select id from creative_projects where id = ${form.projectId} and org_id = ${ctx.orgId} and deleted_at is null`),
    )[0];
    if (!found) throw badRequest('That project is not in this workspace.');
  }
  await saveQwenDraft(ctx, form);
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
      projectId: form.projectId ?? null,
      provider: PROVIDER,
      status: 'QUEUED',
      settings: {
        workerId: worker.id,
        workerLabel: worker.label,
        audioFileId: form.useBuiltin ? null : form.audioFileId,
        audioUploadName: form.useBuiltin ? null : form.audioUploadName,
        audioUploadWorkerId: form.useBuiltin ? null : form.audioUploadWorkerId,
        useBuiltin: form.useBuiltin,
        builtinClip: isClip(form.builtinClip) ? form.builtinClip : BUILTIN,
        referenceText: form.referenceText,
        targetText: form.targetText,
      },
      workflow: { format: 'api', source: WORKFLOW, sha256: qwenWorkflow()!.sha256 },
    })
    .returning();
  await audit(ctx, 'comfy.qwen.generate', { type: 'generation_job', id: job!.id }, undefined, { workerLabel: worker.label });
  return { job: { id: job!.id, status: 'QUEUED' as const } };
}

async function uploadBytes(origin: string, file: { bytes: Buffer; name: string; mime: string }) {
  const form = new FormData();
  form.append('image', new Blob([Uint8Array.from(file.bytes)], { type: file.mime }), file.name);
  form.append('overwrite', 'true');
  form.append('type', 'input');
  const res = await fetch(new URL('/upload/image', origin), { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw badRequest(`ComfyUI refused the audio (${res.status}).`);
  const body = (await res.json()) as { name?: string; subfolder?: string };
  if (!body.name) throw badRequest('ComfyUI did not accept the audio.');
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

async function readStream(body: ReadableStream<Uint8Array>, name: string, mime: string, jobId: string) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > 80 * 1024 * 1024) throw badRequest('That audio is over 80 MB, so it was not sent.');
    chunks.push(next.value);
  }
  const base = (name.split(/[/\\]/).pop() || 'audio.wav').replace(/[^A-Za-z0-9._-]+/g, '_');
  return { bytes: Buffer.concat(chunks), name: `cos_${jobId.slice(0, 8)}_${base}`, mime: mime || 'audio/wav' };
}

function buildPrompt(graph: Graph, audioName: string, referenceText: string, targetText: string, prefix: string, seed: number) {
  const copy = structuredClone(graph);
  for (const node of Object.values(copy)) {
    if (node.class_type === 'LoadAudio' && node.inputs) node.inputs.audio = audioName;
    if (node.class_type === 'Qwen3ExternalVoiceClone' && node.inputs) {
      node.inputs.reference_text = referenceText;
      node.inputs.target_text = targetText;
      node.inputs.filename_prefix = prefix;
      node.inputs.seed = seed;
    }
  }
  return copy;
}

interface QwenJob {
  id: string;
  orgId: string;
  promptId: string | null;
  settings: {
    workerId?: string;
    audioFileId?: string | null;
    audioUploadName?: string | null;
    audioUploadWorkerId?: string | null;
    useBuiltin?: boolean;
    builtinClip?: string;
    referenceText?: string;
    targetText?: string;
    filenamePrefix?: string;
    progress?: { phase: string; detail: string };
    localAudio?: string | null;
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

export async function submitQwenJob(db: Db, env: ServiceEnv, jobId: string) {
  const claimed = rowsOf<QwenJob>(
    await db.execute(sql`
      update generation_jobs
      set status = 'RUNNING', started_at = now(), updated_at = now(), error = null
      where id = ${jobId} and provider = ${PROVIDER} and status = 'QUEUED'
      returning id, org_id as "orgId", prompt_id as "promptId", settings, started_at as "startedAt"`),
  )[0];
  if (!claimed) return { skipped: true };
  try {
    const workflow = qwenWorkflow();
    if (!workflow) throw badRequest(MISSING);
    const settings = claimed.settings ?? {};
    const [worker] = await db
      .select()
      .from(gpuWorkers)
      .where(sql`${gpuWorkers.id} = ${settings.workerId ?? null} and ${gpuWorkers.orgId} = ${claimed.orgId}`)
      .limit(1);
    if (!worker?.enabled) throw badRequest('The PC for this job is no longer in the list.');
    let audioName = settings.audioUploadName ?? null;
    if (settings.useBuiltin) {
      const clip = isClip(settings.builtinClip ?? '') ? settings.builtinClip! : BUILTIN;
      const wav = builtinWav(clip);
      if (!wav) throw badRequest(`The clip ${clip} is not in this install.`);
      audioName = await uploadBytes(worker.baseUrl, {
        bytes: readFileSync(wav),
        name: clip,
        mime: 'audio/wav',
      });
    } else if (settings.audioFileId) {
      const opened = await openAgentFile(db, env, claimed.orgId, settings.audioFileId);
      audioName = await uploadBytes(worker.baseUrl, await readStream(opened.body, opened.name, opened.mime, claimed.id));
    } else if (settings.audioUploadName) {
      audioName = await fileForWorker(env.attachmentsDir, claimed.orgId, worker, {
        name: settings.audioUploadName,
        workerId: settings.audioUploadWorkerId,
      });
    }
    if (!audioName) throw badRequest('The reference audio is no longer attached.');
    const prefix = `CreatorOS/qwen_${claimed.id.slice(0, 8)}`;
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const prompt = buildPrompt(workflow.graph, audioName, settings.referenceText ?? '', settings.targetText ?? '', prefix, seed);
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
    if (!res.ok || rejected || !body.prompt_id) throw badRequest(rejected || `ComfyUI did not start the voice (${res.status}).`);
    await db.execute(sql`
      update generation_jobs
      set prompt_id = ${body.prompt_id}, external_job_id = ${body.prompt_id},
          settings = settings || ${JSON.stringify({ filenamePrefix: prefix, seed })}::jsonb,
          updated_at = now()
      where id = ${claimed.id}`);
    return { promptId: body.prompt_id };
  } catch (e) {
    const message = e instanceof AppError ? e.message : e instanceof Error ? e.message : 'The voice did not start.';
    await failJob(db, claimed.id, message);
    return { failed: message };
  }
}

export async function submitQueuedQwen(db: Db, env: ServiceEnv) {
  const waiting = rowsOf<{ id: string }>(
    await db.execute(sql`
      select id from generation_jobs
      where provider = ${PROVIDER} and status = 'QUEUED'
      order by created_at asc
      limit 2`),
  );
  const out = [];
  for (const job of waiting) out.push(await submitQwenJob(db, env, job.id));
  return out;
}

type HistoryEntry = {
  outputs?: Record<string, Record<string, unknown>>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
};

function audiosFromHistory(entry: HistoryEntry) {
  const message = (entry.status?.messages ?? []).find((m) => Array.isArray(m) && m[0] === 'execution_error') as
    | [string, { exception_message?: string }]
    | undefined;
  const outputs: NonNullable<QwenJob['settings']['outputs']> = [];
  for (const [node, out] of Object.entries(entry.outputs ?? {})) {
    for (const value of Object.values(out ?? {})) {
      const files = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
      for (const file of files) {
        const row = file as { filename?: string; subfolder?: string; type?: string };
        if (!row.filename || !/\.(wav|mp3|flac|ogg|m4a)$/i.test(row.filename)) continue;
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
      if (body[promptId]) return audiosFromHistory(body[promptId]);
    }
  } catch {
    return null;
  }
  try {
    const res = await fetch(new URL('/history', baseUrl), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, HistoryEntry>;
    if (body[promptId]) return audiosFromHistory(body[promptId]);
    return undefined;
  } catch {
    return null;
  }
}

async function keepVoiceCopy(dir: string, orgId: string, jobId: string, filename: string, bytes: Buffer) {
  const ext = (filename.split('.').pop() || 'flac').toLowerCase().replace(/[^a-z0-9]/g, '') || 'flac';
  const rel = `voices/${orgId}/${jobId}.${ext}`;
  const root = resolve(dir);
  const abs = resolve(root, rel);
  if (!abs.startsWith(root)) throw badRequest('That voice path is not allowed.');
  await mkdir(resolve(root, 'voices', orgId), { recursive: true });
  await writeFile(abs, bytes);
  return rel;
}

async function copyVoiceFromPc(baseUrl: string, dir: string, orgId: string, jobId: string, audio: { filename: string; subfolder: string; type: string }) {
  const url = new URL('/view', baseUrl);
  url.searchParams.set('filename', audio.filename);
  url.searchParams.set('subfolder', audio.subfolder);
  url.searchParams.set('type', audio.type || 'output');
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length || bytes.length > 80 * 1024 * 1024) return null;
  return keepVoiceCopy(dir, orgId, jobId, audio.filename, bytes);
}

export async function pollRunningQwen(db: Db, env: ServiceEnv) {
  const running = rowsOf<QwenJob>(
    await db.execute(sql`
      select id, org_id as "orgId", prompt_id as "promptId", settings, started_at as "startedAt"
      from generation_jobs
      where provider = ${PROVIDER} and status = 'RUNNING'
      order by started_at asc
      limit 5`),
  );
  let updated = 0;
  for (const job of running) {
    const age = Date.now() - new Date(job.startedAt ?? 0).getTime();
    if (!job.promptId) {
      if (age > 3 * 60_000) await failJob(db, job.id, 'The voice did not start. Press Generate again.');
      else
        await db.execute(sql`
          update generation_jobs
          set settings = settings || ${JSON.stringify({ progress: { phase: 'sending', detail: 'Sending the reference audio to the PC.' } })}::jsonb,
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
      if (age > 20 * 60_000) await failJob(db, job.id, 'ComfyUI is no longer running this voice.');
      else
        await db.execute(sql`
          update generation_jobs
          set settings = settings || ${JSON.stringify({ progress: { phase: 'rendering', detail: 'Cloning the voice on that PC.' } })}::jsonb,
              updated_at = now()
          where id = ${job.id}`);
      continue;
    }
    if (entry.status === 'error' || (entry.completed && entry.error && !entry.outputs.length)) {
      await failJob(db, job.id, entry.error || 'ComfyUI stopped this voice.');
      updated += 1;
      continue;
    }
    if (!entry.completed || !entry.outputs.length) continue;
    const audio = entry.outputs.find((item) => item.type !== 'temp') ?? entry.outputs[0];
    let localAudio: string | null = null;
    if (audio) {
      try {
        localAudio = await copyVoiceFromPc(worker.baseUrl, env.attachmentsDir, job.orgId, job.id, audio);
      } catch {
        localAudio = null;
      }
    }
    const saved = rowsOf<{ id: string }>(
      await db.execute(sql`
        update generation_jobs
        set status = 'SUCCEEDED', finished_at = now(), updated_at = now(), error = null,
            settings = settings || ${JSON.stringify({ outputs: entry.outputs, localAudio, progress: { phase: 'done', detail: 'Voice is ready.' } })}::jsonb
        where id = ${job.id} and status = 'RUNNING'
        returning id`),
    );
    if (!saved.length) continue;
    await notifyGenerationReady(db, {
      id: job.id,
      orgId: job.orgId,
      provider: PROVIDER,
      settings: { prompt: job.settings.targetText || job.settings.filenamePrefix },
    }).catch(() => undefined);
    await db.execute(sql`delete from generation_outputs where job_id = ${job.id}`);
    for (const output of entry.outputs) {
      await db.insert(generationOutputs).values({
        orgId: job.orgId,
        jobId: job.id,
        node: output.node,
        outputRole: 'voice',
        expectedPath: output.subfolder ? `${output.subfolder}/${output.filename}` : output.filename,
      });
    }
    try {
      await attachJobToProject(db, job.id);
    } catch {
      // The voice is saved. The next scan pass links it to the project.
    }
    updated += 1;
  }
  return { checked: running.length, updated };
}

/** Phones (installed PWA) refuse a float or 24-bit WAV and also refuse a full-file reply when they asked for a byte range. */
export function audioMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a' || ext === 'mp4' || ext === 'aac') return 'audio/mp4';
  if (ext === 'ogg' || ext === 'opus') return 'audio/ogg';
  if (ext === 'flac') return 'audio/flac';
  return 'audio/wav';
}

function wavPcm16(input: Buffer): Buffer | null {
  if (input.length < 44 || input.toString('ascii', 0, 4) !== 'RIFF' || input.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= input.length) {
    const id = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > input.length) break;
    const chunk = input.subarray(start, start + size);
    if (id === 'fmt ' && chunk.length >= 16) {
      format = chunk.readUInt16LE(0);
      channels = chunk.readUInt16LE(2);
      rate = chunk.readUInt32LE(4);
      bits = chunk.readUInt16LE(14);
    } else if (id === 'data') {
      data = Buffer.from(chunk);
    }
    offset = start + size + (size % 2);
  }
  if (!data || !channels || !rate || !bits) return null;
  if (format === 1 && bits === 16) return input;
  const width = bits / 8;
  if (!Number.isInteger(width) || width < 1) return null;
  const samples = Math.floor(data.length / width);
  if (!samples) return null;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const at = i * width;
    let unit = 0;
    if (format === 3 && bits === 32) unit = data.readFloatLE(at);
    else if (format === 3 && bits === 64) unit = data.readDoubleLE(at);
    else if (format === 1 && bits === 8) unit = (data[at]! - 128) / 128;
    else if (format === 1 && bits === 24) {
      let n = data[at]! | (data[at + 1]! << 8) | (data[at + 2]! << 16);
      if (n & 0x800000) n |= ~0xffffff;
      unit = n / 8388608;
    } else if (format === 1 && bits === 32) unit = data.readInt32LE(at) / 2147483648;
    else return null;
    const clipped = Math.max(-1, Math.min(1, unit));
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(clipped * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  const byteRate = rate * channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function toPlayableAudio(filename: string, input: Buffer): { body: Buffer; type: string } {
  const type = audioMime(filename);
  if (type !== 'audio/wav') return { body: input, type };
  return { body: wavPcm16(input) ?? input, type: 'audio/wav' };
}

/** One range, the only kind a phone audio element sends. */
export function sliceAudioRange(body: Buffer, header: string | undefined): { status: 200 | 206 | 416; body: Buffer; contentRange?: string } {
  if (!header) return { status: 200, body };
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return { status: 200, body };
  const start = Number(match[1]);
  if (start >= body.length) return { status: 416, body: Buffer.alloc(0), contentRange: `bytes */${body.length}` };
  const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
  if (end < start) return { status: 416, body: Buffer.alloc(0), contentRange: `bytes */${body.length}` };
  return { status: 206, body: body.subarray(start, end + 1), contentRange: `bytes ${start}-${end}/${body.length}` };
}

export async function openQwenAudio(db: Db, attachmentsDir: string, orgId: string, jobId: string) {
  const [job] = rowsOf<{ settings: QwenJob['settings'] }>(
    await db.execute(sql`
      select settings from generation_jobs
      where id = ${jobId} and org_id = ${orgId} and provider = ${PROVIDER}`),
  );
  if (!job) throw notFound('Voice');
  const kept = job.settings?.localAudio;
  if (kept) {
    const root = resolve(attachmentsDir);
    const abs = resolve(root, kept);
    if (abs.startsWith(root) && existsSync(abs)) {
      return { bytes: readFileSync(abs), filename: kept.split('/').pop() || 'voice.flac' };
    }
  }
  const audio = (job.settings?.outputs ?? []).find((o) => /\.(wav|mp3|flac|ogg|m4a)$/i.test(o.filename));
  if (!audio || audio.type === 'temp') throw notFound('That voice was only a preview on the PC and is no longer there. Generate it again.');
  const [worker] = await db
    .select()
    .from(gpuWorkers)
    .where(sql`${gpuWorkers.id} = ${job.settings?.workerId ?? null} and ${gpuWorkers.orgId} = ${orgId}`)
    .limit(1);
  if (!worker) throw badRequest('The PC that made this voice is no longer in the list.');
  const url = new URL('/view', worker.baseUrl);
  url.searchParams.set('filename', audio.filename);
  url.searchParams.set('subfolder', audio.subfolder);
  url.searchParams.set('type', audio.type || 'output');
  let upstream: Response;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw badRequest('Creator OS could not reach the PC that has this voice.');
  }
  if (!upstream.ok) throw notFound('That voice is no longer on the PC. Generate it again.');
  return { bytes: Buffer.from(await upstream.arrayBuffer()), filename: audio.filename };
}
