import { sql, type Db } from '@creatoros/db';
import { audit } from './audit';
import type { AuthedAgent } from './devices';
import { badRequest, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

/** Task Scheduler names only. No quotes or shell characters. A leading folder is allowed, as in \Mehak\ComfyUI. */
export function validWindowsTaskName(name: string) {
  const value = name.trim();
  if (value.length < 1 || value.length > 200) return false;
  if (/["'`|&;<>\n\r$]/.test(value)) return false;
  return /^\\?(?:[A-Za-z0-9][A-Za-z0-9 ._-]{0,64}\\)*[A-Za-z0-9][A-Za-z0-9 ._-]{0,64}$/.test(value);
}

const STATUSES = new Set(['RUNNING', 'READY', 'DISABLED', 'NOT_FOUND', 'UNKNOWN']);

export async function listWindowsTasks(ctx: Ctx) {
  const devices = rowsOf<{ id: string; displayName: string; state: string; os: string | null; lastSeenAt: Date | null }>(
    await ctx.db.execute(sql`
      select id, display_name as "displayName", state, os, last_seen_at as "lastSeenAt"
      from devices
      where org_id = ${ctx.orgId} and state <> 'REVOKED'
      order by display_name`),
  );
  const tasks = rowsOf<{
    id: string;
    deviceId: string;
    deviceName: string;
    deviceState: string;
    label: string;
    taskName: string;
    status: string;
    detail: string | null;
    checkedAt: Date | null;
    restartStatus: string | null;
    restartError: string | null;
  }>(
    await ctx.db.execute(sql`
      select t.id, t.device_id as "deviceId", d.display_name as "deviceName", d.state as "deviceState",
             t.label, t.task_name as "taskName", t.status, t.detail, t.checked_at as "checkedAt",
             r.status as "restartStatus", r.error as "restartError"
      from windows_tasks t
      join devices d on d.id = t.device_id
      left join lateral (
        select status, error from windows_task_restarts
        where task_id = t.id
        order by created_at desc
        limit 1
      ) r on true
      where t.org_id = ${ctx.orgId}
      order by d.display_name, t.label`),
  );
  return { devices, tasks };
}

export async function addWindowsTask(ctx: Ctx, input: { deviceId: string; label: string; taskName: string }) {
  const taskName = input.taskName.trim();
  const label = input.label.trim();
  if (!label || label.length > 80) throw badRequest('Give this task a short name, such as ComfyUI or Telegram.');
  if (!validWindowsTaskName(taskName)) throw badRequest('Use the Task Scheduler name, such as \\ComfyUI. Do not include quotes or extra commands.');
  const device = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`select id from devices where id = ${input.deviceId} and org_id = ${ctx.orgId} and state <> 'REVOKED'`),
  )[0];
  if (!device) throw badRequest('That PC is not paired.');
  const [row] = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      insert into windows_tasks (org_id, device_id, label, task_name)
      values (${ctx.orgId}, ${input.deviceId}, ${label}, ${taskName})
      on conflict (device_id, task_name) do update set label = excluded.label, updated_at = now()
      returning id`),
  );
  await audit(ctx, 'windows_task.add', { type: 'windows_task', id: row!.id }, undefined, { label, taskName });
  return { id: row!.id };
}

export async function removeWindowsTask(ctx: Ctx, id: string) {
  const [row] = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`delete from windows_tasks where id = ${id} and org_id = ${ctx.orgId} returning id`),
  );
  if (!row) throw notFound('Task');
  await audit(ctx, 'windows_task.remove', { type: 'windows_task', id }, undefined, {});
  return { ok: true };
}

export async function requestWindowsTaskRestart(ctx: Ctx, id: string) {
  const task = rowsOf<{ id: string; deviceId: string; label: string }>(
    await ctx.db.execute(sql`
      select id, device_id as "deviceId", label from windows_tasks
      where id = ${id} and org_id = ${ctx.orgId}`),
  )[0];
  if (!task) throw notFound('Task');
  const open = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      select id from windows_task_restarts
      where task_id = ${task.id} and status in ('PENDING', 'RUNNING')
      limit 1`),
  )[0];
  if (open) return { id: open.id, status: 'PENDING' as const };
  const [row] = rowsOf<{ id: string }>(
    await ctx.db.execute(sql`
      insert into windows_task_restarts (org_id, task_id, device_id, requested_by)
      values (${ctx.orgId}, ${task.id}, ${task.deviceId}, ${ctx.userId})
      returning id`),
  );
  await audit(ctx, 'windows_task.restart', { type: 'windows_task', id: task.id }, undefined, { label: task.label });
  return { id: row!.id, status: 'PENDING' as const };
}

export async function agentWindowsTasks(db: Db, agent: AuthedAgent) {
  const tasks = rowsOf<{ id: string; taskName: string }>(
    await db.execute(sql`
      select id, task_name as "taskName" from windows_tasks
      where device_id = ${agent.deviceId}
      order by label`),
  );
  const restarts = await db.transaction(async (tx) =>
    rowsOf<{ id: string; taskId: string; taskName: string }>(
      await tx.execute(sql`
        update windows_task_restarts r
        set status = 'RUNNING'
        where r.id in (
          select id from windows_task_restarts
          where device_id = ${agent.deviceId} and status in ('PENDING', 'RUNNING')
          order by created_at
          limit 5
          for update skip locked
        )
        returning r.id, r.task_id as "taskId",
          (select task_name from windows_tasks where id = r.task_id) as "taskName"`),
    ),
  );
  return { tasks, restarts };
}

export async function reportWindowsTask(db: Db, agent: AuthedAgent, input: { id: string; status: string; detail?: string }) {
  const status = STATUSES.has(input.status) ? input.status : 'UNKNOWN';
  const detail = (input.detail ?? '').slice(0, 500);
  const [row] = rowsOf<{ id: string }>(
    await db.execute(sql`
      update windows_tasks
      set status = ${status}, detail = ${detail}, checked_at = now(), updated_at = now()
      where id = ${input.id} and device_id = ${agent.deviceId}
      returning id`),
  );
  if (!row) throw notFound('Task');
  return { ok: true };
}

export async function finishWindowsTaskRestart(
  db: Db,
  agent: AuthedAgent,
  input: { id: string; ok: boolean; error?: string; status?: string; detail?: string },
) {
  const job = rowsOf<{ id: string; taskId: string; status: string }>(
    await db.execute(sql`
      select id, task_id as "taskId", status from windows_task_restarts
      where id = ${input.id} and device_id = ${agent.deviceId}`),
  )[0];
  if (!job) throw notFound('Restart');
  if (job.status === 'SUCCEEDED' || job.status === 'FAILED') return { ok: job.status === 'SUCCEEDED' };
  const error = input.ok ? null : (input.error || 'The PC could not restart that task.').slice(0, 500);
  await db.execute(sql`
    update windows_task_restarts
    set status = ${input.ok ? 'SUCCEEDED' : 'FAILED'}, error = ${error}, finished_at = now()
    where id = ${job.id}`);
  if (input.status) {
    const status = STATUSES.has(input.status) ? input.status : 'UNKNOWN';
    await db.execute(sql`
      update windows_tasks
      set status = ${status}, detail = ${(input.detail ?? '').slice(0, 500)}, checked_at = now(), updated_at = now()
      where id = ${job.taskId} and device_id = ${agent.deviceId}`);
  }
  return { ok: input.ok };
}
