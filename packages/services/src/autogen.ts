import { autogenClips, autogenRuns, gpuWorkers, sql, type Db } from '@creatoros/db';
import { autogenClipSeconds, parseAutogenTimestamps } from '@creatoros/domain';
import { generateLtx, ltxApiWorkflow, machineQueue } from './comfy';
import { createProject } from './projects';
import { badRequest, conflict, notFound, type Ctx, type ServiceEnv } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

function songTitle(name: string) {
  const base = (name.split(/[/\\]/).pop() || 'Song').replace(/\.[^.]+$/, '').trim();
  return (base || 'Song').slice(0, 180);
}

function clean(e: unknown) {
  return (e instanceof Error ? e.message : 'The clip could not be queued.').slice(0, 500);
}

export async function listAutogen(ctx: Ctx) {
  const runs = rowsOf<{
    id: string;
    title: string;
    prompt: string;
    status: string;
    projectId: string | null;
    audioLengthSec: number | null;
    createdAt: Date;
  }>(await ctx.db.execute(sql`
    select id, title, prompt, status, project_id as "projectId", audio_length_sec as "audioLengthSec", created_at as "createdAt"
    from autogen_runs
    where org_id = ${ctx.orgId}
    order by created_at desc
    limit 20`));
  const ids = runs.map((run) => run.id);
  const clips = ids.length
    ? rowsOf<{
        id: string;
        runId: string;
        ordinal: number;
        startSec: number;
        durationSec: number | null;
        status: string;
        attempt: number;
        workerLabel: string | null;
        error: string | null;
      }>(await ctx.db.execute(sql`
        select id, run_id as "runId", ordinal, start_sec as "startSec", duration_sec as "durationSec",
               status, attempt, worker_label as "workerLabel", error
        from autogen_clips
        where org_id = ${ctx.orgId} and run_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        order by ordinal asc`))
    : [];
  const workers = await ctx.db
    .select({ id: gpuWorkers.id, label: gpuWorkers.label, enabled: gpuWorkers.enabled })
    .from(gpuWorkers)
    .where(sql`${gpuWorkers.orgId} = ${ctx.orgId} and ${gpuWorkers.enabled} = true`);
  return {
    workers,
    runs: runs.map((run) => ({ ...run, clips: clips.filter((clip) => clip.runId === run.id) })),
  };
}

export async function createAutogenRun(
  ctx: Ctx,
  input: {
    prompt: string;
    timestamps: string;
    songName: string;
    audioLengthSec?: number | null;
    audioFileId?: string | null;
    imageFileId?: string | null;
    audioUploadName?: string | null;
    audioUploadWorkerId?: string | null;
    imageUploadName?: string | null;
    imageUploadWorkerId?: string | null;
  },
) {
  const prompt = input.prompt.trim();
  if (!prompt) throw badRequest('Write the prompt. Every clip uses it.');
  if (prompt.length > 20000) throw badRequest('The prompt is too long.');
  const starts = parseAutogenTimestamps(input.timestamps);
  if (!starts.length) throw badRequest('Enter at least one start time in seconds, such as 0, 30, 75.');
  const audioFileId = input.audioFileId || null;
  const imageFileId = input.imageFileId || null;
  const audioUploadName = audioFileId ? null : input.audioUploadName?.trim() || null;
  const imageUploadName = imageFileId ? null : input.imageUploadName?.trim() || null;
  if (!audioFileId && !audioUploadName) throw badRequest('Choose a song from the library, or upload one.');
  if (!imageFileId && !imageUploadName) throw badRequest('Choose a reference image from the library, or upload one.');
  let audioLengthSec = input.audioLengthSec != null && Number.isFinite(input.audioLengthSec) ? input.audioLengthSec : null;
  if (audioFileId) {
    const file = rowsOf<{ durationMs: number | null; fileName: string }>(await ctx.db.execute(sql`
      select file_name as "fileName", nullif(tech->>'durationMs', '')::float8 as "durationMs"
      from file_instances
      where id = ${audioFileId} and org_id = ${ctx.orgId} and archived_at is null`))[0];
    if (!file) throw badRequest('That song is not in the library.');
    if (file.durationMs != null) audioLengthSec = file.durationMs / 1000;
  }
  if (audioLengthSec != null) {
    const late = starts.filter((start) => audioLengthSec! - start < 1);
    if (late.length) throw badRequest(`These starts do not leave one second of the song: ${late.join(', ')}.`);
  }
  const title = songTitle(input.songName);
  const existing = rowsOf<{ id: string }>(await ctx.db.execute(sql`
    select id from creative_projects
    where org_id = ${ctx.orgId} and deleted_at is null and lower(title) = lower(${title})
    order by created_at asc
    limit 1`))[0];
  const project = existing ?? (await createProject(ctx, { title, type: 'OTHER', contentFormat: 'SHORTS' }));
  const now = ctx.now();
  const [run] = await ctx.db
    .insert(autogenRuns)
    .values({
      orgId: ctx.orgId,
      userId: ctx.userId,
      projectId: project.id,
      title,
      prompt,
      status: 'RUNNING',
      audioFileId,
      imageFileId,
      audioUploadName,
      audioUploadWorkerId: audioFileId ? null : input.audioUploadWorkerId || null,
      imageUploadName,
      imageUploadWorkerId: imageFileId ? null : input.imageUploadWorkerId || null,
      audioLengthSec,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: autogenRuns.id });
  await ctx.db.insert(autogenClips).values(
    starts.map((startSec, ordinal) => ({
      orgId: ctx.orgId,
      runId: run!.id,
      ordinal,
      startSec,
      status: 'WAITING',
      createdAt: now,
      updatedAt: now,
    })),
  );
  return { id: run!.id, projectId: project.id, title, clips: starts.length };
}

/** Cancel one AutoGen clip, never the whole PC or another queued render.
 * WAITING has no machine assignment. For ComfyUI jobs we require the exact prompt ID,
 * verify it on that GPU, and only then call ComfyUI's targeted queue/interrupt endpoint.
 */
export async function cancelAutogenClip(ctx: Ctx, clipId: string) {
  const [clip] = rowsOf<{
    id: string; runId: string; status: string; workerId: string | null;
    workerLabel: string | null; jobId: string | null; promptId: string | null;
    jobStatus: string | null;
  }>(await ctx.db.execute(sql`
    select c.id, c.run_id as "runId", c.status, c.worker_id as "workerId",
      c.worker_label as "workerLabel", c.job_id as "jobId",
      j.prompt_id as "promptId", j.status as "jobStatus"
    from autogen_clips c
    join autogen_runs r on r.id = c.run_id
    left join generation_jobs j on j.id = c.job_id
    where c.id = ${clipId} and c.org_id = ${ctx.orgId} and r.org_id = ${ctx.orgId}
  `));
  if (!clip) throw notFound('AutoGen clip');
  if (clip.status === 'CANCELLED') return { cancelled: true, clipId, alreadyCancelled: true };
  if (clip.status === 'READY' || clip.status === 'FAILED') throw conflict('Only waiting or running clips can be cancelled.');
  if (clip.status === 'CLAIMED' || (clip.status === 'RUNNING' && !clip.promptId)) {
    throw conflict('This clip is being submitted to the PC. Retry in a few seconds once its ComfyUI prompt ID is available.');
  }
  if (clip.status === 'WAITING') {
    const changed = rowsOf<{ id: string }>(await ctx.db.execute(sql`
      update autogen_clips set status = 'CANCELLED', error = 'Cancelled by owner', updated_at = now()
      where id = ${clipId} and org_id = ${ctx.orgId} and status = 'WAITING'
      returning id
    `));
    if (!changed.length) throw conflict('This clip was claimed while cancelling. Refresh and try again.');
  } else {
    if (!clip.workerId || !clip.jobId || !clip.promptId) throw conflict('Cannot identify the exact ComfyUI render to stop.');
    const [worker] = rowsOf<{ baseUrl: string }>(await ctx.db.execute(sql`
      select base_url as "baseUrl" from gpu_workers where id = ${clip.workerId} and org_id = ${ctx.orgId}
    `));
    if (!worker) throw conflict('The assigned PC is no longer configured.');
    let queue: { queue_running?: unknown[]; queue_pending?: unknown[] };
    try {
      const response = await fetch(new URL('/queue', worker.baseUrl), { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Queue unavailable');
      queue = await response.json() as typeof queue;
    } catch {
      throw conflict('Cannot reach the assigned PC to confirm which render to stop. Nothing was cancelled.');
    }
    const containsId = (entries: unknown[] | undefined) =>
      (entries ?? []).some((entry) => Array.isArray(entry) && entry[1] === clip.promptId);
    const pending = containsId(queue.queue_pending);
    const running = containsId(queue.queue_running);
    // Do not send ComfyUI's machine-wide /interrupt unless this exact prompt is running.
    if (pending || running) {
      const endpoint = running ? '/interrupt' : '/queue';
      const body = running ? { prompt_id: clip.promptId } : { delete: [clip.promptId] };
      let stopped: Response;
      try {
        stopped = await fetch(new URL(endpoint, worker.baseUrl), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw conflict('The PC could not confirm the stop request. Check its queue and retry.');
      }
      if (!stopped.ok) throw conflict('ComfyUI rejected the stop request. The clip remains active.');
    }
    const changed = rowsOf<{ id: string }>(await ctx.db.execute(sql`
      update autogen_clips set status = 'CANCELLED', error = 'Cancelled by owner', updated_at = now()
      where id = ${clipId} and org_id = ${ctx.orgId} and status = 'RUNNING' and job_id = ${clip.jobId}
      returning id
    `));
    if (!changed.length) throw conflict('The clip finished while cancelling. Refresh its status.');
    await ctx.db.execute(sql`
      update generation_jobs set status = 'CANCELLED',
        error = 'Cancelled by owner in AutoGen', finished_at = now(), updated_at = now()
      where id = ${clip.jobId} and org_id = ${ctx.orgId} and status in ('QUEUED','RUNNING')
    `);
  }
  await ctx.db.execute(sql`
    update autogen_runs set status = 'DONE', updated_at = now()
    where id = ${clip.runId} and org_id = ${ctx.orgId}
      and not exists (select 1 from autogen_clips c where c.run_id = ${clip.runId}
        and c.status in ('WAITING','CLAIMED','RUNNING'))
  `);
  return { cancelled: true, clipId, machine: clip.workerLabel ?? null };
}

/** Move finished clips, send a failed clip to the other PC once, then fill each free PC with the next start. */
export async function dispatchAutogen(db: Db, env: ServiceEnv) {
  const running = rowsOf<{
    id: string;
    runId: string;
    attempt: number;
    workerId: string | null;
    jobStatus: string | null;
    jobError: string | null;
  }>(await db.execute(sql`
    select c.id, c.run_id as "runId", c.attempt, c.worker_id as "workerId", j.status as "jobStatus", j.error as "jobError"
    from autogen_clips c
    left join generation_jobs j on j.id = c.job_id
    where c.status = 'RUNNING'`));
  await db.execute(sql`
    update autogen_clips
    set status = 'WAITING', worker_id = null, worker_label = null, duration_sec = null, updated_at = now()
    where status = 'CLAIMED' and updated_at < now() - interval '10 minutes'`);
  for (const clip of running) {
    if (clip.jobStatus === 'SUCCEEDED') {
      await db.execute(sql`update autogen_clips set status = 'READY', error = null, updated_at = now() where id = ${clip.id}`);
    } else if (clip.jobStatus === 'FAILED' || clip.jobStatus === 'CANCELLED' || clip.jobStatus == null) {
      const message = clip.jobError || (clip.jobStatus == null ? 'The render job is gone.' : 'The PC did not finish this clip.');
      if (clip.attempt < 1 && clip.workerId) {
        await db.execute(sql`
          update autogen_clips
          set status = 'WAITING', attempt = attempt + 1, exclude_worker_id = ${clip.workerId},
              worker_id = null, worker_label = null, job_id = null, duration_sec = null,
              error = ${message.slice(0, 500)}, updated_at = now()
          where id = ${clip.id}`);
      } else {
        await db.execute(sql`
          update autogen_clips set status = 'FAILED', error = ${message.slice(0, 500)}, updated_at = now() where id = ${clip.id}`);
      }
    }
  }

  const open = rowsOf<{
    id: string;
    orgId: string;
    userId: string | null;
    projectId: string | null;
    title: string;
    prompt: string;
    audioFileId: string | null;
    imageFileId: string | null;
    audioUploadName: string | null;
    audioUploadWorkerId: string | null;
    imageUploadName: string | null;
    imageUploadWorkerId: string | null;
    audioLengthSec: number | null;
  }>(await db.execute(sql`
    select r.id, r.org_id as "orgId", r.user_id as "userId", r.project_id as "projectId", r.title, r.prompt,
           r.audio_file_id as "audioFileId", r.image_file_id as "imageFileId",
           r.audio_upload_name as "audioUploadName", r.audio_upload_worker_id as "audioUploadWorkerId",
           r.image_upload_name as "imageUploadName", r.image_upload_worker_id as "imageUploadWorkerId",
           r.audio_length_sec as "audioLengthSec"
    from autogen_runs r
    where r.status = 'RUNNING'
    order by r.created_at asc`));

  for (const run of open) {
    const workers = await db
      .select()
      .from(gpuWorkers)
      .where(sql`${gpuWorkers.orgId} = ${run.orgId} and ${gpuWorkers.enabled} = true`);
    const waiting = rowsOf<{ id: string; startSec: number; attempt: number; excludeWorkerId: string | null }>(
      await db.execute(sql`
        select id, start_sec as "startSec", attempt, exclude_worker_id as "excludeWorkerId"
        from autogen_clips
        where run_id = ${run.id} and status = 'WAITING'
        order by ordinal asc`),
    );
    for (const clip of waiting) {
      if (clip.attempt > 0 && !workers.some((worker) => worker.id !== clip.excludeWorkerId)) {
        await db.execute(sql`
          update autogen_clips
          set status = 'FAILED', error = 'The other PC is not available for a retry.', updated_at = now()
          where id = ${clip.id}`);
      }
    }
    const still = waiting.filter((clip) => clip.attempt === 0 || workers.some((worker) => worker.id !== clip.excludeWorkerId));
    const free = [];
    for (const worker of workers) {
      if ((await machineQueue(db, run.orgId, worker)) === 'free') free.push(worker);
    }
    const preset = ltxApiWorkflow()?.preset ?? null;
    for (const worker of free) {
      const index = still.findIndex((clip) => clip.excludeWorkerId !== worker.id);
      if (index < 0) continue;
      const clip = still.splice(index, 1)[0]!;
      if (!preset) {
        await db.execute(sql`
          update autogen_clips set error = 'The LTX workflow file is not on this server.', updated_at = now() where id = ${clip.id}`);
        continue;
      }
      const duration = autogenClipSeconds(worker, clip.startSec, run.audioLengthSec);
      if (duration == null) {
        await db.execute(sql`
          update autogen_clips set status = 'FAILED', error = 'The song ends before this start.', updated_at = now() where id = ${clip.id}`);
        continue;
      }
      const claimed = rowsOf<{ id: string }>(await db.execute(sql`
        update autogen_clips
        set status = 'CLAIMED', duration_sec = ${duration}, worker_id = ${worker.id}, worker_label = ${worker.label},
            error = null, updated_at = now()
        where id = ${clip.id} and status = 'WAITING'
        returning id`));
      if (!claimed.length) continue;
      try {
        const ctx: Ctx = {
          db,
          env,
          orgId: run.orgId,
          userId: run.userId,
          actor: { type: 'system' },
          now: () => new Date(),
        };
        const queued = await generateLtx(
          ctx,
          {
            projectId: run.projectId,
            workerId: worker.id,
            imageFileId: run.imageFileId,
            audioFileId: run.audioFileId,
            audioStartSec: clip.startSec,
            durationSec: duration,
            prompt: run.prompt,
            negativePrompt: preset.negativePrompt,
            width: preset.width,
            height: preset.height,
            fps: preset.fps,
            loraName: preset.loraName,
            loraStrength: preset.loraStrength,
            upscaleWidth: preset.upscale.width,
            upscaleHeight: preset.upscale.height,
            upscaleResizeType: 'target dimensions',
            upscaleQuality: preset.upscale.quality === 'LOW' || preset.upscale.quality === 'MEDIUM' || preset.upscale.quality === 'HIGH' ? preset.upscale.quality : 'ULTRA',
            wantUpscale: true,
            imageUploadName: run.imageUploadName,
            imageUploadWorkerId: run.imageUploadWorkerId,
            audioUploadName: run.audioUploadName,
            audioUploadWorkerId: run.audioUploadWorkerId,
          },
          { skipDraft: true, allowUploadCopy: true },
        );
        await db.execute(sql`
          update autogen_clips
          set status = 'RUNNING', duration_sec = ${duration}, worker_id = ${worker.id}, worker_label = ${worker.label},
              job_id = ${queued.job.id}, error = null, updated_at = now()
          where id = ${clip.id}`);
      } catch (e) {
        await db.execute(sql`
          update autogen_clips set status = 'FAILED', error = ${clean(e)}, updated_at = now() where id = ${clip.id}`);
      }
    }
    await db.execute(sql`
      update autogen_runs
      set status = 'DONE', updated_at = now()
      where id = ${run.id}
        and not exists (
          select 1 from autogen_clips c where c.run_id = ${run.id} and c.status in ('WAITING', 'CLAIMED', 'RUNNING')
        )`);
  }
}
