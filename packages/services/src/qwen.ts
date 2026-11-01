import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { generationJobs, generationOutputs, gpuWorkers, qwenDrafts, sql, type Db } from '@creatoros/db';
import { openAgentFile } from './agent-file';
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
      provider: PROVIDER,
      status: 'QUEUED',
      settings: {
        workerId: worker.id,
        workerLabel: worker.label,
        audioFileId: form.useBuiltin ? null : form.audioFileId,
        audioUploadName: form.useBuiltin ? null : form.audioUploadName,
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
    useBuiltin?: boolean;
    builtinClip?: string;
    referenceText?: string;
    targetText?: string;
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

export async function pollRunningQwen(db: Db, env: ServiceEnv) {
  void env;
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
    const saved = rowsOf<{ id: string }>(
      await db.execute(sql`
        update generation_jobs
        set status = 'SUCCEEDED', finished_at = now(), updated_at = now(), error = null,
            settings = settings || ${JSON.stringify({ outputs: entry.outputs, progress: { phase: 'done', detail: 'Voice is ready.' } })}::jsonb
        where id = ${job.id} and status = 'RUNNING'
        returning id`),
    );
    if (!saved.length) continue;
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
    updated += 1;
  }
  return { checked: running.length, updated };
}

export async function openQwenAudio(db: Db, orgId: string, jobId: string, range?: string) {
  const [job] = rowsOf<{ settings: QwenJob['settings'] }>(
    await db.execute(sql`
      select settings from generation_jobs
      where id = ${jobId} and org_id = ${orgId} and provider = ${PROVIDER}`),
  );
  if (!job) throw notFound('Voice');
  const audio = (job.settings?.outputs ?? []).find((o) => /\.(wav|mp3|flac|ogg|m4a)$/i.test(o.filename));
  if (!audio) throw notFound('Voice');
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
    upstream = await fetch(url, { headers: range ? { range } : {}, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw badRequest('Creator OS could not reach the PC that has this voice.');
  }
  return { upstream, filename: audio.filename };
}
