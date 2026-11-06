'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { canOpen } from '@/components/nav';
import { uxV5 } from '@/components/ux-v5-flag';
import { useMe } from '@/components/shell';
import { Async, Badge, Card, CardTitle, EmptyState, Notice, PageHeader, Stat } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { when } from '@/lib/format';

function todayHeading(tz?: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/Vancouver',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('weekday')} · ${part('month')} ${part('day')}, ${part('year')}`;
}

const COUNT_LINKS: Record<string, { label: string; href: string; tone?: 'warn' | 'bad' }> = {
  needReply: {
    label: 'Need a reply',
    href: '/collaborations?tab=inbox&state=NEED_REPLY&linked=deal',
    tone: 'warn',
  },
  possibleCollabs: {
    label: 'Possible collaborations to review',
    href: '/collaborations?tab=inbox&triage=POSSIBLE&category=COLLABORATION&opportunity=none',
  },
  overdueInvoices: {
    label: 'Overdue invoices',
    href: '/collaborations?tab=invoices&status=OVERDUE',
    tone: 'bad',
  },
  dueToday: { label: 'Due today', href: '/today?due=today' },
  openActions: { label: 'Open actions', href: '/today' },
  scheduledToday: { label: 'Scheduled today', href: '/calendar' },
  devicesOffline: { label: 'Devices offline', href: '/storage', tone: 'warn' },
  unlinkedMedia: { label: 'Files not linked to an asset', href: '/library?linked=false' },
  unmatchedPublications: { label: 'Posts to match', href: '/publishing?tab=unmatched' },
};

export default function HomePage() {
  if (uxV5()) return <TodayWorkspace />;
  return <HomeClassic />;
}

function TodayWorkspace() {
  const me = useMe();
  const role = me.data?.user?.role as string | undefined;
  const tz = me.data?.organization?.timezone;
  const briefing = useApi<any>('/briefing', { refreshInterval: 60_000 });
  const actions = useApi<any[]>('/actions', { query: { state: 'OPEN', limit: 6 } });
  const projects = useApi<any[]>('/projects', { query: { limit: 8 } });
  const studio = useApi<{
    devices: { id: string; displayName: string; state: string }[];
    tasks: { id: string; deviceId: string; label: string; taskName: string; status: string; deviceState: string }[];
  }>(canOpen(role, '/comfy') ? '/comfy/windows-tasks' : null);
  const b = briefing.data;
  const open = (actions.data ?? []).filter((a) => a.state === 'OPEN').slice(0, 4);
  const active = (projects.data ?? []).filter((p) => p.stage !== 'ARCHIVED').slice(0, 2);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-extrabold tracking-[0.16em] text-accent">
            {todayHeading(tz)}
          </p>
          <h1 className="font-serif text-[33px] leading-tight font-medium">One place to move everything forward.</h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted">
            Your next decisions, active productions and opportunities. Every count and button opens a real record.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/content" className="rounded-[10px] border border-border bg-panel px-3.5 py-2.5 text-sm font-semibold">
            + Capture idea
          </Link>
          {canOpen(role, '/publishing') && (
            <Link href="/publishing" className="rounded-[10px] bg-accent px-3.5 py-2.5 text-sm font-semibold text-white">
              Start a post
            </Link>
          )}
        </div>
      </header>

      <section className="relative mb-4 flex min-h-[180px] items-center overflow-hidden rounded-[20px] bg-[#203f37] px-7 py-6 text-white">
        <div>
          <p className="text-[11px] font-extrabold tracking-[0.13em] text-[#c2e2d0]">TODAY’S FOCUS</p>
          <h2 className="mt-1 max-w-lg font-serif text-[27px] leading-tight font-medium">
            Good work is moving. Here’s what needs you.
          </h2>
          <p className="mt-2 max-w-md text-xs leading-relaxed text-[#d8e7df]">
            Prioritize the next action. Background jobs and existing integrations keep running independently of this screen.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/today" className="rounded-[10px] bg-[#e6a986] px-3 py-2 text-sm font-semibold text-[#1d332b]">
              Open my work queue
            </Link>
            <Link href="/notifications" className="rounded-[10px] border border-white/30 px-3 py-2 text-sm font-semibold">
              Review alerts
            </Link>
          </div>
        </div>
        <div className="ml-auto hidden text-center sm:block">
          <div className="font-serif text-[42px] leading-none">{b?.counts?.openActions ?? '—'}</div>
          <div className="text-xs text-[#c8dfd1]">open actions</div>
        </div>
      </section>

      <Async res={briefing}>
        {(brief) => (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Object.entries(brief.counts).map(([k, v]) => {
              const meta = COUNT_LINKS[k];
              if (!meta || !canOpen(role, meta.href.split('?')[0] ?? '/')) return null;
              return (
                <Link key={k} href={meta.href} className="rounded-[15px] border border-border bg-panel p-4">
                  <span className="text-xs text-muted">{meta.label}</span>
                  <strong className="mt-1 block text-[27px] tracking-tight">{Number(v)}</strong>
                </Link>
              );
            })}
          </div>
        )}
      </Async>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.22fr)_minmax(0,0.78fr)]">
        <div className="space-y-4">
          <section className="rounded-[17px] border border-border bg-panel p-5 shadow-[0_8px_38px_rgba(30,50,45,0.035)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Needs your decision</h2>
              <Link href="/notifications" className="text-xs font-bold text-[#267965]">
                View all notifications
              </Link>
            </div>
            {(b?.top ?? []).length === 0 ? (
              <p className="text-sm text-muted">Nothing urgent. Capture an idea or check the library.</p>
            ) : (
              (b.top as any[]).map((t) => {
                const href = t.deepLink ? String(t.deepLink) : '/today';
                const openLink = canOpen(role, href.split('?')[0] ?? '/');
                return (
                  <div key={t.id} className="flex items-center gap-3 border-b border-[#edf0eb] py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-bold">{t.title}</div>
                      <div className="mt-1 text-[11px] text-muted">
                        {(t.reasons ?? []).join(' · ')}
                        {t.dueAt ? ` · ${when(t.dueAt, tz, false)}` : ''}
                      </div>
                    </div>
                    {openLink && (
                      <Link href={href} className="rounded-[10px] border border-border px-2.5 py-1.5 text-[11px] font-semibold">
                        Review
                      </Link>
                    )}
                  </div>
                );
              })
            )}
          </section>

          <section className="rounded-[17px] border border-border bg-panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Continue where you stopped</h2>
              <Link href="/production" className="text-xs font-bold text-[#267965]">
                Open production board
              </Link>
            </div>
            {active.length === 0 ? (
              <p className="text-sm text-muted">No active projects yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {active.map((p) => (
                  <article key={p.id} className="rounded-[15px] border border-border p-3">
                    <h3 className="text-[13px] font-semibold">{p.title}</h3>
                    <p className="mt-1 text-[11px] text-muted">
                      {String(p.type ?? '').replaceAll('_', ' ').toLowerCase()} · {String(p.stage ?? '').replaceAll('_', ' ').toLowerCase()}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Link href={`/production/${p.id}`} className="rounded-[10px] bg-[#23453b] px-2.5 py-1.5 text-[11px] font-semibold text-white">
                        Continue
                      </Link>
                      <Link href="/library" className="rounded-[10px] border border-border px-2.5 py-1.5 text-[11px] font-semibold">
                        View assets
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-[17px] border border-border bg-panel p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">My tasks</h2>
              <Link href="/today" className="text-xs font-bold text-[#267965]">
                All tasks
              </Link>
            </div>
            {open.length === 0 ? (
              <p className="text-sm text-muted">No open tasks.</p>
            ) : (
              open.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-b border-[#edf0eb] py-3 last:border-0">
                  <input
                    type="checkbox"
                    aria-label={`Complete ${a.title}`}
                    className="accent-[#3e8b72]"
                    onChange={async () => {
                      await post(`/actions/${a.id}/complete`, {});
                      await refresh('/actions', '/briefing');
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-bold">{a.title}</div>
                    <div className="mt-1 text-[11px] text-muted">
                      {a.reason}
                      {a.dueAt ? ` · ${when(a.dueAt, tz, false)}` : ''}
                    </div>
                  </div>
                  {a.deepLink && canOpen(role, String(a.deepLink).split('?')[0] ?? '/') && (
                    <Link href={a.deepLink} className="text-xs font-bold text-[#267965]">
                      Open
                    </Link>
                  )}
                </div>
              ))
            )}
            <Link href="/today" className="mt-3 inline-block rounded-[10px] border border-border px-2.5 py-1.5 text-[11px] font-semibold">
              + Add task
            </Link>
          </section>

          <section className="rounded-[17px] border border-border bg-panel p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Publishing next</h2>
              {canOpen(role, '/publishing') && (
                <Link href="/publishing" className="text-xs font-bold text-[#267965]">
                  Full workspace
                </Link>
              )}
            </div>
            <p className="text-sm text-muted">
              {b?.counts?.scheduledToday ?? 0} scheduled today. {b?.counts?.unmatchedPublications ?? 0} posts still need a file match.
            </p>
            {canOpen(role, '/publishing') && (
              <Link href="/publishing" className="mt-3 inline-block rounded-[10px] bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white">
                Compose new post
              </Link>
            )}
          </section>

          {canOpen(role, '/comfy') && (
            <section className="rounded-[17px] border border-border bg-panel p-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold">Studio & workers</h2>
                <Link href="/comfy" className="text-xs font-bold text-[#267965]">
                  Open studio
                </Link>
              </div>
              {(() => {
                const devices = studio.data?.devices ?? [];
                const tasks = studio.data?.tasks ?? [];
                if (devices.length === 0) {
                  return <p className="text-sm text-muted">No paired PC yet. Pair one, then add its tasks in Create Studio → Settings.</p>;
                }
                return devices.map((device) => {
                  const mine = tasks.filter((task) => task.deviceId === device.id);
                  return (
                    <div key={device.id} className="border-b border-[#edf0eb] py-3 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12.5px] font-bold">{device.displayName}</div>
                        <span
                          className={
                            device.state === 'ONLINE'
                              ? 'rounded-full bg-[#e6f4ee] px-2 py-1 text-[10px] font-bold text-[#22735c]'
                              : 'rounded-full bg-[#f3f1ea] px-2 py-1 text-[10px] font-bold text-[#6d6458]'
                          }
                        >
                          {device.state === 'ONLINE' ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      {mine.length === 0 ? (
                        <p className="mt-1 text-[11px] text-muted">No task watched on this PC.</p>
                      ) : (
                        mine.map((task) => (
                          <div key={task.id} className="mt-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[12px] font-semibold">{task.label}</div>
                              <div className="text-[11px] text-muted">{task.taskName}</div>
                            </div>
                            <span className="shrink-0 text-[10px] font-bold text-[#5c6b63]">
                              {task.status === 'RUNNING'
                                ? 'Running'
                                : task.status === 'READY'
                                  ? 'Ready'
                                  : task.status === 'DISABLED'
                                    ? 'Disabled'
                                    : task.status === 'NOT_FOUND'
                                      ? 'Not found'
                                      : 'Not checked yet'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  );
                });
              })()}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function HomeClassic() {
  const me = useMe();
  const briefing = useApi<any>('/briefing', { refreshInterval: 60_000 });
  const health = useApi<any>('/system/health', { refreshInterval: 60_000 });
  const tz = me.data?.organization?.timezone;
  const role = me.data?.user?.role as string | undefined;

  const problems = Object.entries(health.data?.checks ?? {}).filter(([, c]: any) => !c.ok);

  return (
    <>
      <PageHeader
        title={
          uxV5()
            ? 'Today'
            : `Hello${me.data ? `, ${String(me.data.user.name).split(' ')[0]}` : ''}`
        }
        subtitle={
          uxV5()
            ? 'Decisions waiting on you. Each count opens the same list it always did.'
            : 'What deserves your attention right now.'
        }
      />
      {me.data?.organization?.demoLoaded && (
        <div className="mb-4">
          <Notice tone="info" title="Demo data is loaded">
            Records starting with “DEMO” are samples. Remove them any time in Settings → Demo data.
          </Notice>
        </div>
      )}

      <Async res={briefing}>
        {(b) => (
          <div className="space-y-5">
            <Card>
              <CardTitle action={<span className="text-xs text-muted">{b.today}</span>}>
                Your top {Math.min(3, b.top.length) || 3} right now
              </CardTitle>
              {b.top.length === 0 ? (
                <EmptyState title="Nothing urgent">
                  You're clear. Capture an idea, plan a post, or check the library.
                </EmptyState>
              ) : (
                <ol className="space-y-2">
                  {b.top.slice(0, 3).map((t: any, i: number) => {
                    const href = t.deepLink ? String(t.deepLink) : '';
                    const open = Boolean(href) && canOpen(role, href.split('?')[0] ?? '/');
                    const body = (
                      <>
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{t.title}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {t.reasons?.map((r: string) => (
                              <Badge key={r}>{r}</Badge>
                            ))}
                            {t.dueAt && <Badge tone="info">{when(t.dueAt, tz, false)}</Badge>}
                          </div>
                        </div>
                        {open && <ArrowRight className="size-4 shrink-0 text-accent" aria-hidden />}
                      </>
                    );
                    return open ? (
                      <li key={t.id}>
                        <Link
                          href={href}
                          className="flex items-start gap-3 rounded-lg border border-border p-3 hover:border-accent/60"
                        >
                          {body}
                        </Link>
                      </li>
                    ) : (
                      <li key={t.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                        {body}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>

            <section aria-label="Counts" className="space-y-2">
              {uxV5() && <h2 className="text-sm font-semibold">Needs a decision</h2>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {Object.entries(b.counts).map(([k, v]) => {
                const meta = COUNT_LINKS[k];
                if (!meta || !canOpen(role, meta.href.split('?')[0] ?? '/')) return null;
                const n = Number(v);
                return (
                  <Link key={k} href={meta.href} className="block rounded-xl focus-visible:outline-2">
                    <Stat label={meta.label} value={n} tone={n > 0 ? meta.tone : undefined} />
                  </Link>
                );
              })}
              </div>
            </section>
          </div>
        )}
      </Async>

      {problems.length > 0 && (
        <div className="mt-5 space-y-2">
          <h2 className="text-sm font-semibold">System status</h2>
          {problems.map(([name, c]: any) => (
            <Notice key={name} tone="warn" title={`${name}: needs attention`}>
              {c.detail ?? 'See Settings → System for details.'}
            </Notice>
          ))}
        </div>
      )}
    </>
  );
}
