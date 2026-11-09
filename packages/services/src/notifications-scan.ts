import { sql, type Db } from '@creatoros/db';
import { notify } from './notifications';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

/**
 * Raises reminders from rows Kemokem already stores.
 * Each call is safe to repeat: notify() ignores a duplicate dedupe key.
 * Completed, dismissed, and deleted tasks are not selected.
 */
export async function scanReminders(db: Db, now = new Date()): Promise<{ created: number }> {
  let created = 0;
  const note = async (input: Parameters<typeof notify>[1]) => {
    if (await notify(db, input, now)) created += 1;
  };

  const orgs = rowsOf<{ orgId: string; userId: string; tz: string; digestHour: number; weeklyDay: string | null }>(
    await db.execute(sql`
      select o.id as "orgId", o.owner_user_id as "userId",
             coalesce(p.timezone, o.timezone, 'America/Vancouver') as tz,
             coalesce(p.digest_hour, 8) as "digestHour",
             p.channels->>'weeklyDay' as "weeklyDay"
      from organizations o
      left join notification_preferences p on p.org_id = o.id and p.user_id = o.owner_user_id
    `),
  );

  for (const org of orgs) {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: org.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(now);
    const part = (type: string) => local.find((p) => p.type === type)?.value ?? '';
    const day = `${part('year')}-${part('month')}-${part('day')}`;
    const hour = Number(part('hour'));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));

    const tasks = rowsOf<{ id: string; title: string; overdue: boolean }>(
      await db.execute(sql`
        select id, title, (due_at < now()) as overdue
        from internal_actions
        where org_id = ${org.orgId}::uuid
          and state = 'OPEN'
          and due_at is not null
          and due_at < now() + interval '1 day'
          and (snoozed_until is null or snoozed_until <= now())
          and dismissed_at is null
          and completed_at is null
        order by due_at
        limit 40
      `),
    );
    for (const task of tasks) {
      await note({
        orgId: org.orgId,
        userId: org.userId,
        type: task.overdue ? 'task.overdue' : 'task.due',
        dedupeKey: `${task.overdue ? 'task.overdue' : 'task.due'}:${task.id}:${day}`,
        title: task.overdue ? `Overdue: ${task.title}` : `Due soon: ${task.title}`,
        severity: task.overdue ? 'WARNING' : 'INFO',
        deepLink: '/today',
        sourceType: 'internal_action',
        sourceId: task.id,
      });
    }

    const soon = rowsOf<{ id: string; title: string | null; accountId: string }>(
      await db.execute(sql`
        select id, title, social_account_id as "accountId"
        from publish_drafts
        where org_id = ${org.orgId}::uuid
          and upload_state = 'SCHEDULED'
          and scheduled_at is not null
          and scheduled_at > now()
          and scheduled_at < now() + interval '2 hours'
        limit 20
      `),
    );
    for (const draft of soon) {
      await note({
        orgId: org.orgId,
        userId: org.userId,
        type: 'publish.soon',
        dedupeKey: `publish.soon:${draft.id}`,
        title: draft.title ? `Scheduled: ${draft.title}` : 'A post is scheduled soon',
        deepLink: '/publishing',
        sourceType: 'publish_draft',
        sourceId: draft.id,
        accountId: draft.accountId,
      });
    }

    const failedJobs = rowsOf<{ id: string; error: string | null }>(
      await db.execute(sql`
        select id, error from generation_jobs
        where org_id = ${org.orgId}::uuid and status = 'FAILED'
          and coalesce(finished_at, updated_at) > now() - interval '2 days'
        order by coalesce(finished_at, updated_at) desc
        limit 20
      `),
    );
    for (const job of failedJobs) {
      await note({
        orgId: org.orgId,
        userId: org.userId,
        type: 'workflow.failed',
        dedupeKey: `workflow.failed:${job.id}`,
        title: 'A generation failed',
        body: (job.error ?? 'Open the job to see what stopped it.').slice(0, 180),
        severity: 'WARNING',
        deepLink: '/comfy#history',
        sourceType: 'generation_job',
        sourceId: job.id,
      });
    }

    const expired = rowsOf<{ id: string; provider: string }>(
      await db.execute(sql`
        select id, provider from provider_connections
        where org_id = ${org.orgId}::uuid and state = 'AUTH_EXPIRED'
        limit 20
      `),
    );
    for (const conn of expired) {
      await note({
        orgId: org.orgId,
        userId: org.userId,
        type: 'oauth.expired',
        dedupeKey: `oauth.expired:${conn.id}:${day}`,
        title: `${conn.provider} needs to be connected again`,
        severity: 'WARNING',
        deepLink: '/integrations',
        sourceType: 'provider_connection',
        sourceId: conn.id,
      });
    }

    if (hour === org.digestHour) {
      const open = rowsOf<{ n: number }>(
        await db.execute(
          sql`select count(*)::int as n from internal_actions where org_id = ${org.orgId}::uuid and state = 'OPEN'`,
        ),
      )[0]?.n ?? 0;
      await note({
        orgId: org.orgId,
        userId: org.userId,
        type: 'briefing.daily',
        dedupeKey: `briefing.daily:${org.userId}:${day}`,
        title: 'Daily summary',
        body: open ? `${open} open task${open === 1 ? '' : 's'} on Today.` : 'No open tasks on Today.',
        deepLink: '/today',
      });
      const weekly = Number(org.weeklyDay ?? '1');
      if (weekday === weekly) {
        await note({
          orgId: org.orgId,
          userId: org.userId,
          type: 'briefing.weekly',
          dedupeKey: `briefing.weekly:${org.userId}:${day}`,
          title: 'Weekly summary',
          body: open ? `${open} open task${open === 1 ? '' : 's'} are still on Today.` : 'No open tasks this week.',
          deepLink: '/today',
        });
      }
    }
  }
  return { created };
}
