'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Calendar, Lightbulb, Pencil, Plus, Send, Sparkles, TrendingUp } from 'lucide-react';
import { useMe } from '@/components/shell';
import { PlatformLogo, platformLabel } from '@/components/platform-logo';
import { api, post, refresh, useApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { useToast } from '@/components/ui';
import { localDate, addDays } from '@creatoros/domain';
import { BannerEditor, blobToDataUrl } from './today-command';

type Board = {
  today: string;
  timezone: string;
  generatedAt: string;
  hasCover: boolean;
  counts: { openActions: number; scheduledToday: number; overdueInvoices: number; possibleCollabs: number };
  decisions: { id: string; title: string; detail: string | null; href: string }[];
  queue: { id: string; title: string; state: string; priority: string; dueAt: string | null; deepLink: string | null; reason: string | null }[];
  projects: { id: string; title: string; stage: string; type: string; updatedAt: string; tags: string[] | null; scenes: number; done: number }[];
  posts: { id: string; title: string | null; state: string; plannedAt: string | null; provider: string; handle: string | null }[];
  invoices: { id: string; invoiceNo: string; currency: string; amountMinor: string; dueAt: string | null }[];
  leads: { id: string; subject: string | null }[];
  machines: { name: string; state: string; seenAt: string | null; kind: string }[];
  metrics: { platform: string; metric: string; value: string | null; collectedAt: string }[];
};

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coverId(tags: string[] | null) {
  const hit = (tags ?? []).find((tag) => tag.startsWith('cover:'));
  const id = hit?.slice('cover:'.length) ?? '';
  return FILE_ID.test(id) ? id : '';
}

function greet(tz: string | undefined, name: string | undefined) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Vancouver', hour: 'numeric', hourCycle: 'h23' }).format(new Date()),
  );
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${hello}, ${first}` : hello;
}

function dateLine(tz?: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/Vancouver',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
    .format(new Date())
    .toUpperCase();
}

function when(value: string | null, tz?: string) {
  if (!value) return 'No date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/Vancouver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function money(minor: string, currency: string) {
  const amount = Number(minor) / 100;
  if (!Number.isFinite(amount)) return currency;
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency || 'CAD' }).format(amount);
}

function fresh(seenAt: string | null, kind: string) {
  if (!seenAt) return kind === 'comfy' ? 'Not checked' : 'No heartbeat';
  const age = Date.now() - new Date(seenAt).getTime();
  if (kind === 'agent' && age > 180_000) return 'Heartbeat stale';
  if (kind === 'comfy' && age > 15 * 60_000) return 'Check is stale';
  const mins = Math.max(0, Math.round(age / 60000));
  return mins < 1 ? 'Just now' : `${mins} min ago`;
}

export function TodayHome({ onPlan }: { onPlan: () => void }) {
  const me = useMe();
  const tz = me.data?.organization?.timezone as string | undefined;
  const name = me.data?.user?.name as string | undefined;
  const { id: workspaceId } = useWorkspace();
  const board = useApi<Board>(workspaceId ? '/today/board' : null, { query: { brandId: workspaceId } });
  const data = board.data;
  const [projectTab, setProjectTab] = useState<'progress' | 'recent' | 'all'>('progress');
  const [day, setDay] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [asked, setAsked] = useState(false);
  const [coverTick, setCoverTick] = useState(0);
  const coverSrc = workspaceId ? `/api/v1/today/cover?brandId=${workspaceId}&v=${coverTick}` : '';
  const [coverBusy, setCoverBusy] = useState(false);
  const [editor, setEditor] = useState<{ source: string } | null>(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  const photoFile = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const week = useMemo(() => {
    const zone = data?.timezone || tz || 'America/Vancouver';
    const today = data?.today || localDate(new Date(), zone);
    const noon = new Date(`${today}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(noon);
    const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
    const monday = addDays(today, -(index < 0 ? 0 : index));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [data?.today, data?.timezone, tz]);

  const marks = useMemo(() => {
    const zone = data?.timezone || tz || 'America/Vancouver';
    const bag = new Map<string, number>();
    const add = (value: string | null) => {
      if (!value) return;
      const key = localDate(new Date(value), zone);
      bag.set(key, (bag.get(key) ?? 0) + 1);
    };
    data?.posts.forEach((post) => add(post.plannedAt));
    data?.queue.forEach((item) => add(item.dueAt));
    return bag;
  }, [data, tz]);

  async function complete(id: string) {
    await post(`/actions/${id}/complete`);
    await refresh('/today/board', '/actions', '/briefing');
  }

  const projects = (data?.projects ?? []).filter((project) => {
    if (projectTab === 'all') return true;
    if (projectTab === 'recent') return true;
    return !['PUBLISHED', 'ARCHIVED'].includes(project.stage);
  });
  const tasks = (data?.queue ?? []).filter((item) => item.state === 'OPEN').slice(0, 5);
  const done = (data?.queue ?? []).filter((item) => item.state === 'DONE').length;
  const open = (data?.queue ?? []).filter((item) => item.state === 'OPEN').length;
  const progress = open + done ? Math.round((done / (open + done)) * 100) : 0;
  const selected = day || data?.today;
  const selectedItems = [
    ...(data?.posts ?? []).filter((item) => item.plannedAt && localDate(new Date(item.plannedAt), data?.timezone || 'America/Vancouver') === selected),
    ...(data?.queue ?? []).filter((item) => item.dueAt && localDate(new Date(item.dueAt), data?.timezone || 'America/Vancouver') === selected && item.state === 'OPEN'),
  ];

  return (
    <div className="space-y-4 pb-10">
      <header>
        <p className="text-[11px] font-extrabold tracking-[0.16em] text-muted">{dateLine(tz)}</p>
        <h1 className="font-serif text-[34px] leading-tight font-medium text-text">{greet(tz, name)}</h1>
        <p className="mt-1 text-sm text-muted">Your workspace to plan, create, publish, and follow the work that is actually waiting.</p>
      </header>

      <section className="relative overflow-hidden rounded-[22px] bg-[#203f34] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(232,214,176,0.18),transparent_32%),linear-gradient(100deg,#1b3830_0%,#203f34_55%,#2c5a49_100%)]" />
        {data?.hasCover ? (
          <div className="absolute inset-0 md:inset-y-0 md:right-0 md:left-auto md:w-[42%]">
            <img alt="" src={coverSrc} className="size-full object-cover object-center md:object-right" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#203f34] via-[#203f34]/80 to-[#203f34]/30 md:from-[#203f34] md:via-[#203f34]/35 md:to-transparent" />
          </div>
        ) : (
          <div className="absolute top-6 right-8 hidden h-36 w-36 rounded-full bg-[#e7d7b8]/20 md:block" />
        )}
        <div className="relative max-w-xl px-6 py-6 md:px-8 md:py-8">
          <p className="text-[11px] font-extrabold tracking-[0.16em] text-[#d7efe4]">TODAY&apos;S FOCUS</p>
          <h2 className="mt-2 font-serif text-3xl leading-tight">Move your top projects forward.</h2>
          <p className="mt-2 text-sm text-[#e7f3ec]">
            {data
              ? `${data.decisions.length} decisions need attention, ${data.counts.openActions} actions are still open, and ${data.counts.scheduledToday} posts are scheduled today.`
              : board.error
                ? board.error.message
                : 'Loading today’s records…'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/today" className="inline-flex min-h-11 items-center rounded-full bg-[#e7b08c] px-4 text-sm font-semibold text-[#203f34]">
              Review what needs me
            </Link>
            <Link href="/production" className="inline-flex min-h-11 items-center rounded-full border border-white/30 px-4 text-sm font-semibold">
              Open production
            </Link>
          </div>
        </div>
      <div className="absolute right-3 bottom-3 z-20">
        <button
          type="button"
          aria-label="Edit photo"
          aria-expanded={photoMenu}
          className="grid size-11 place-items-center rounded-full bg-white text-[#203f34] shadow-md"
          onClick={() => setPhotoMenu((open) => !open)}
        >
          <Pencil className="size-4" />
        </button>
        {photoMenu ? (
          <div className="absolute right-0 bottom-12 w-44 rounded-xl border border-border bg-panel p-1 text-sm text-text shadow-lg">
            {data?.hasCover ? (
              <button
                type="button"
                className="block min-h-11 w-full rounded-lg px-3 text-left font-semibold hover:bg-panel2"
                onClick={async () => {
                  setPhotoMenu(false);
                  try {
                    const res = await fetch(`/api/v1/today/cover/source?brandId=${workspaceId}&v=${coverTick}`, { credentials: 'same-origin' });
                    if (!res.ok) throw new Error('The photo could not be opened.');
                    setEditor({ source: await blobToDataUrl(await res.blob()) });
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                Edit banner
              </button>
            ) : null}
            <button
              type="button"
              className="block min-h-11 w-full rounded-lg px-3 text-left font-semibold hover:bg-panel2"
              onClick={() => {
                setPhotoMenu(false);
                photoFile.current?.click();
              }}
            >
              {coverBusy ? 'Saving photo…' : data?.hasCover ? 'Change photo' : 'Add photo'}
            </button>
            {data?.hasCover ? (
              <button
                type="button"
                className="block min-h-11 w-full rounded-lg px-3 text-left font-semibold hover:bg-panel2"
                disabled={coverBusy}
                onClick={async () => {
                  setPhotoMenu(false);
                  if (!window.confirm('Remove the workspace photo from Today?')) return;
                  setCoverBusy(true);
                  try {
                    await api('/today/cover', { method: 'DELETE', query: { brandId: workspaceId } });
                    setCoverTick(Date.now());
                    await refresh('/today/board');
                    toast.ok('Photo removed.');
                  } catch (err) {
                    toast.error(err);
                  } finally {
                    setCoverBusy(false);
                  }
                }}
              >
                Remove photo
              </button>
            ) : null}
          </div>
        ) : null}
        <input
          ref={photoFile}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          className="sr-only"
          disabled={coverBusy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              setEditor({ source: await blobToDataUrl(file) });
            } catch (err) {
              toast.error(err);
            }
          }}
        />
      </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile href="/production" icon={<Plus className="size-4" />} tint="bg-[#e7f3ec] text-[#203f34]" title="New project" text="Start production" />
        <Tile href="/content" icon={<Lightbulb className="size-4" />} tint="bg-[#f6ead7] text-[#8a5a22]" title="Capture idea" text="Save a spark" />
        <Tile href="/comfy" icon={<Sparkles className="size-4" />} tint="bg-[#e5f2ea] text-[#24624a]" title="Create with AI" text="Generate and edit" />
        <Tile href="/calendar" icon={<Calendar className="size-4" />} tint="bg-[#f8e4dc] text-[#c95c46]" title="Plan content" text="Open calendar" />
        <Tile href="/publishing" icon={<Send className="size-4" />} tint="bg-[#e7eef8] text-[#2d4f78]" title="Compose post" text="Write and schedule" />
        <Tile href="/analytics" icon={<TrendingUp className="size-4" />} tint="bg-[#e8f6ef] text-[#1f7a4d]" title="Track growth" text="View analytics" />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi n={data?.decisions.length} label="Decisions to review" hint="Open high-priority work" href="/today" />
        <Kpi n={data?.counts.openActions} label="Open actions" hint="Everything still to do" href="/today" />
        <Kpi n={data?.counts.overdueInvoices} label="Overdue invoices" hint="Need follow-up" href="/collaborations?tab=invoices&status=OVERDUE" />
        <Kpi n={data?.counts.scheduledToday} label="Scheduled today" hint="On the publishing calendar" href="/calendar" />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.8fr)_minmax(16rem,0.8fr)]">
        <div className="space-y-4">
          <Panel title="Needs your decision" href="/today" link="All notifications">
            {(data?.decisions.length ?? 0) === 0 ? <p className="text-sm text-muted">No high-priority decision is waiting.</p> : null}
            <ul className="divide-y divide-border">
              {data?.decisions.slice(0, 4).map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{item.title}</p>
                    {item.detail ? <p className="text-xs text-muted">{item.detail}</p> : null}
                  </div>
                  <Link href={item.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-text">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Continue where you left off" href="/production" link="Open production">
            <div className="mb-3 flex gap-2">
              {(['progress', 'recent', 'all'] as const).map((tab) => (
                <button key={tab} type="button" className={`min-h-11 rounded-full px-3 text-xs font-semibold capitalize ${projectTab === tab ? 'bg-[#203f34] text-white' : 'border border-border'}`} onClick={() => setProjectTab(tab)}>
                  {tab === 'progress' ? 'In progress' : tab}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {projects.slice(0, 4).map((project) => {
                const file = coverId(project.tags);
                const ratio = project.scenes ? Math.round((project.done / project.scenes) * 100) : null;
                return (
                  <article key={project.id} className="overflow-hidden rounded-2xl border border-border">
                    {file ? (
                      <img alt="" src={`/api/v1/files/${file}/preview`} className="h-28 w-full object-cover" />
                    ) : (
                      <div className="flex h-28 items-end bg-[#203f34] p-3 text-sm text-white">{project.stage.replace(/_/g, ' ').toLowerCase()}</div>
                    )}
                    <div className="p-3">
                      <h3 className="font-semibold">{project.title}</h3>
                      <p className="text-xs text-muted">{project.type.replace(/_/g, ' ').toLowerCase()} · {project.stage.replace(/_/g, ' ').toLowerCase()}</p>
                      {ratio != null ? <p className="mt-1 text-xs text-muted">{project.done} of {project.scenes} scenes selected</p> : null}
                      <div className="mt-2 flex gap-3 text-sm font-semibold">
                        <Link href={`/production/${project.id}`} className="min-h-11 inline-flex items-center">Continue</Link>
                        <Link href={`/library?q=${encodeURIComponent(project.title)}`} className="min-h-11 inline-flex items-center text-muted">View assets</Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {projects.length === 0 ? <p className="text-sm text-muted">No project in this list.</p> : null}
          </Panel>
          <Panel title="Content calendar" href="/calendar" link="Open calendar">
            <div className="grid grid-cols-7 gap-1">
              {week.map((date) => {
                const on = date === (selected || data?.today);
                const count = marks.get(date) ?? 0;
                return (
                  <button key={date} type="button" className={`min-h-16 rounded-xl px-1 py-2 text-center ${on ? 'bg-[#203f34] text-white' : 'bg-panel2'}`} onClick={() => setDay(date)}>
                    <span className="block text-[10px] uppercase">{date.slice(8)}</span>
                    {count ? <span className={`mx-auto mt-1 block size-1.5 rounded-full ${on ? 'bg-[#e7b08c]' : 'bg-[#c95c46]'}`} /> : null}
                  </button>
                );
              })}
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {selectedItems.length === 0 ? <li className="text-muted">Nothing scheduled on {selected}.</li> : null}
              {selectedItems.slice(0, 4).map((item) => (
                <li key={item.id}>{item.title || 'Untitled'}</li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="My tasks" href="/today" link="All tasks">
            <p className="mb-2 text-xs text-muted">{done} completed in this list · {open} still open</p>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[#e7eee9]">
              <div className="h-full bg-[#203f34]" style={{ width: `${progress}%` }} />
            </div>
            <ul className="space-y-2">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-start gap-2">
                  <button type="button" className="mt-0.5 size-5 rounded border border-border" aria-label={`Complete ${task.title}`} onClick={() => void complete(task.id)} />
                  <span className="min-w-0">
                    <Link href={task.deepLink || `/today?action=${task.id}`} className="font-medium hover:underline">{task.title}</Link>
                    <span className="block text-xs text-muted">{task.reason || task.priority}{task.dueAt ? ` · ${when(task.dueAt, tz)}` : ''}</span>
                  </span>
                </li>
              ))}
              {tasks.length === 0 ? <li className="text-sm text-muted">No open task in the queue.</li> : null}
            </ul>
          </Panel>
          <Panel title="Publishing next" href="/publishing" link="Full workspace">
            <ul className="divide-y divide-border">
              {(data?.posts ?? []).map((item) => (
                <li key={item.id} className="flex items-center gap-2 py-2">
                  <PlatformLogo platform={item.provider === 'manual' ? 'youtube' : item.provider} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.title || 'Untitled post'}</span>
                    <span className="block text-xs text-muted">{platformLabel(item.provider)}{item.handle ? ` · ${item.handle}` : ''} · {when(item.plannedAt, tz)}</span>
                  </span>
                  <span className="text-xs font-semibold">{item.state === 'FAILED' ? 'Failed' : item.state === 'READY' ? 'Ready' : item.state === 'SCHEDULED' ? 'Scheduled' : 'Planned'}</span>
                </li>
              ))}
              {(data?.posts.length ?? 0) === 0 ? <li className="py-2 text-sm text-muted">No upcoming post is scheduled.</li> : null}
            </ul>
            <Link href="/publishing" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-[#203f34] px-3 text-sm font-semibold text-white">Compose post</Link>
          </Panel>
          <Panel title="Opportunities & revenue" href="/collaborations" link="Collaborations">
            <ul className="divide-y divide-border text-sm">
              {data?.leads.map((lead) => (
                <li key={lead.id} className="py-2">
                  <Link href={`/collaborations/threads/${lead.id}`} className="font-semibold hover:underline">{lead.subject || 'Possible collaboration'}</Link>
                  <p className="text-xs text-muted">Possible inquiry · not qualified</p>
                </li>
              ))}
              {data?.invoices.map((invoice) => (
                <li key={invoice.id} className="py-2">
                  <Link href={`/collaborations/invoices/${invoice.id}`} className="font-semibold hover:underline">Invoice {invoice.invoiceNo}</Link>
                  <p className="text-xs text-muted">Overdue · {money(invoice.amountMinor, invoice.currency)} · not received</p>
                </li>
              ))}
              {(data?.leads.length ?? 0) + (data?.invoices.length ?? 0) === 0 ? <li className="py-2 text-muted">No open inquiry or overdue invoice.</li> : null}
            </ul>
            <p className="mt-2 text-xs text-muted">{data?.counts.possibleCollabs ?? 0} possible collaborations are still unqualified.</p>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="AI Co-Pilot" href="/comfy" link="Create Studio">
            <p className="text-sm text-muted">No chat model is connected. These open the tools that already exist. Nothing here invents a reply.</p>
            <ul className="mt-3 space-y-2 text-sm font-semibold">
              <li><Link href="/content" className="hover:underline">Give me content ideas for next week</Link></li>
              <li><Link href="/content" className="hover:underline">Turn my notes into a script</Link></li>
              <li><Link href="/comfy" className="hover:underline">Help me edit this video</Link></li>
            </ul>
            <form
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                setAsked(true);
              }}
            >
              <input value={ask} onChange={(event) => setAsk(event.target.value)} placeholder="Ask anything…" className="min-h-11 w-full rounded-full border border-border bg-transparent px-4 text-sm" />
            </form>
            {asked ? <p className="mt-2 text-xs text-muted">A chat model is not configured, so this was not sent. Use Create Studio or Content for the work itself.</p> : null}
          </Panel>
          <Panel title="Growth at a glance" href="/analytics" link="Analytics">
            {(data?.metrics.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">No stored analytics yet. A platform total appears here after a successful sync. Nothing is estimated.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data?.metrics.slice(0, 4).map((metric) => (
                  <li key={`${metric.platform}-${metric.metric}`} className="flex items-center justify-between gap-3">
                    <span>{platformLabel(metric.platform)} · {metric.metric.replace(/_/g, ' ')}</span>
                    <span className="font-semibold">{Number(metric.value).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">
              Latest stored account totals. They are not added across platforms.
              {data?.metrics[0] ? ` Last sync ${when(data.metrics[0].collectedAt, tz)}.` : ''}
            </p>
          </Panel>
          <Panel title="Studio & workers" href="/comfy" link="Open studio">
            <ul className="divide-y divide-border text-sm">
              {(data?.machines ?? []).map((machine) => (
                <li key={`${machine.kind}-${machine.name}`} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="block font-medium">{machine.name}</span>
                    <span className="text-xs text-muted">{machine.kind === 'agent' ? 'Scanner agent' : 'ComfyUI'} · {fresh(machine.seenAt, machine.kind)}</span>
                  </span>
                  <span className="text-xs font-semibold">{machine.state === 'ONLINE' ? 'Online' : machine.state === 'UNKNOWN' ? 'Not checked' : 'Offline'}</span>
                </li>
              ))}
              {(data?.machines.length ?? 0) === 0 ? <li className="py-2 text-muted">No scanner or ComfyUI machine is saved.</li> : null}
            </ul>
          </Panel>
          <button type="button" className="text-sm font-semibold text-muted underline" onClick={onPlan}>
            Open the day plan, focus timer, and review
          </button>
        </div>
      </div>
      <BannerEditor
        source={editor?.source ?? null}
        busy={coverBusy}
        onClose={() => setEditor(null)}
        onSave={async (banner) => {
          if (!editor) return;
          setCoverBusy(true);
          try {
            await post('/today/cover', { mime: 'image/jpeg', data: banner, source: editor.source, brandId: workspaceId });
            setCoverTick(Date.now());
            setEditor(null);
            await refresh('/today/board');
            toast.ok('Banner saved.');
          } catch (err) {
            toast.error(err);
          } finally {
            setCoverBusy(false);
          }
        }}
      />
    </div>
  );
}

function Tile({ href, icon, tint, title, text }: { href: string; icon: ReactNode; tint: string; title: string; text: string }) {
  return (
    <Link href={href} className="flex min-h-[88px] items-center gap-3 rounded-[18px] border border-border bg-panel p-3 hover:border-[#203f34]">
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tint}`}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
    </Link>
  );
}

function Kpi({ n, label, hint, href }: { n: number | undefined; label: string; hint: string; href: string }) {
  return (
    <Link href={href} className="rounded-[18px] border border-border bg-panel p-4 hover:border-[#203f34]">
      <div className="font-serif text-4xl text-text">{n == null ? '…' : n}</div>
      <div className="font-semibold">{label}</div>
      <div className="text-xs text-muted">{hint}</div>
    </Link>
  );
}

function Panel({ title, href, link, children }: { title: string; href: string; link: string; children: ReactNode }) {
  return (
    <section className="rounded-[18px] border border-border bg-panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <Link href={href} className="text-xs font-semibold text-[#267965]">{link}</Link>
      </div>
      {children}
    </section>
  );
}
