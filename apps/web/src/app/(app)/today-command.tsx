'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/components/shell';
import { Button, Dialog, Field, Input, Textarea, useToast } from '@/components/ui';
import { del, patch, post, put, refresh, useApi } from '@/lib/api';
import { focusRemaining, type FocusClock } from '@creatoros/domain';

type Board = {
  today: string;
  timezone: string;
  generatedAt: string;
  hasCover: boolean;
  overPlan: boolean;
  calendarConnected: boolean;
  counts: { possibleCollabs: number; scheduledToday: number; openActions: number; unmatchedPublications: number };
  outcomes: {
    actionId: string;
    title: string;
    state: string;
    priority: string;
    dueAt: string | null;
    deepLink: string | null;
    effortMinutes: number | null;
    nextAction: string | null;
    blockAt: string | null;
  }[];
  capacity: { capacityMinutes: number; plannedMinutes: number; remainingMinutes: number; over: boolean };
  blocks: { at: string | null; title: string; minutes: number }[];
  decisions: { id: string; title: string; detail: string | null; href: string }[];
  projects: { id: string; title: string; stage: string; type: string; updatedAt: string }[];
  queue: { id: string; title: string; state: string; priority: string; dueAt: string | null; deepLink: string | null; reason: string | null }[];
  focus: (FocusClock & { id: string; actionId: string | null; actionTitle: string | null; resumeNote: string | null; remainingMs: number }) | null;
  review: { notes: string; checks: Record<string, boolean> };
  health: { backup: { state: string; finishedAt: string | null } | null; offlineDevices: number; workersDown: number; authExpired: number };
};

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function heading(tz?: string) {
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

export function TodayCommand() {
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const board = useApi<Board>('/today/board');
  const [mode, setMode] = useState<'plan' | 'focus' | 'review'>('plan');
  const [queue, setQueue] = useState<'all' | 'today' | 'backlog' | 'waiting' | 'done'>('all');
  const [tick, setTick] = useState(Date.now());
  const [note, setNote] = useState('');
  const [review, setReview] = useState('');
  const [carry, setCarry] = useState<string[]>([]);
  const [coverTick, setCoverTick] = useState(0);
  const [coverBusy, setCoverBusy] = useState(false);
  const [editor, setEditor] = useState<{ source: string } | null>(null);
  const toast = useToast();
  const data = board.data;

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    const onShow = () => {
      if (document.visibilityState === 'visible') {
        setTick(Date.now());
        void refresh('/today/board');
      }
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);
  useEffect(() => {
    if (data?.focus?.resumeNote != null) setNote(data.focus.resumeNote);
  }, [data?.focus?.id, data?.focus?.resumeNote]);
  useEffect(() => {
    if (data) setReview(data.review.notes ?? '');
  }, [data?.today, data?.review.notes]);

  const remaining = useMemo(() => {
    if (!data?.focus) return 0;
    return focusRemaining(data.focus, tick);
  }, [data?.focus, tick]);

  async function reload() {
    await refresh('/today/board', '/actions', '/briefing');
  }

  return (
    <div className="space-y-4 pb-8">
      <section className="relative -mx-3 -mt-3 min-h-[220px] overflow-hidden bg-[#203f34] text-white md:-mx-8 md:-mt-7">
        {data?.hasCover ? (
          <img alt="" src={`/api/v1/today/cover?v=${coverTick}`} className="absolute inset-0 size-full object-cover object-center" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[#101816]/85 via-[#101816]/35 to-[#101816]/10" />
        <div className="relative flex min-h-[220px] flex-col justify-between gap-6 p-4 md:p-8">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-extrabold tracking-[0.16em] text-[#d7efe4]">{heading(tz)}</p>
            <div className="flex gap-2">
              {data?.hasCover ? (
                <button
                  type="button"
                  className="rounded-full bg-white/20 px-3 py-2 text-xs font-semibold backdrop-blur"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/v1/today/cover/source?v=${coverTick}`, { credentials: 'same-origin' });
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
              <label className="cursor-pointer rounded-full bg-white/20 px-3 py-2 text-xs font-semibold backdrop-blur">
                {coverBusy ? 'Saving photo…' : 'Change photo'}
                <input
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
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-serif text-[34px] leading-tight font-medium">Make today count.</h1>
              <p className="mt-1 max-w-xl text-sm text-[#e7f3ec]">A focused command center for your next action, real commitments and exceptions.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['plan', 'focus', 'review'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold capitalize ${mode === item ? 'bg-white text-[#203f34]' : 'bg-white/15 text-white'}`}
                  onClick={() => setMode(item)}
                >
                  {item}
                </button>
              ))}
              <Link href="/content" className="inline-flex min-h-11 items-center rounded-full bg-[#c95c46] px-4 text-sm font-semibold text-white">
                Capture idea
              </Link>
            </div>
          </div>
        </div>
      </section>

      {!data ? (
        <p className="text-sm text-muted">{board.error ? board.error.message : 'Loading today’s records…'}</p>
      ) : mode === 'focus' ? (
        <FocusPane data={data} remaining={remaining} note={note} setNote={setNote} onDone={reload} />
      ) : mode === 'review' ? (
        <ReviewPane data={data} notes={review} setNotes={setReview} carry={carry} setCarry={setCarry} onDone={reload} />
      ) : (
        <PlanPane data={data} queue={queue} setQueue={setQueue} onDone={reload} />
      )}
      <BannerEditor
        source={editor?.source ?? null}
        busy={coverBusy}
        onClose={() => setEditor(null)}
        onSave={async (banner) => {
          if (!editor) return;
          setCoverBusy(true);
          try {
            await post('/today/cover', { mime: 'image/jpeg', data: banner, source: editor.source });
            setCoverTick(Date.now());
            setEditor(null);
            await reload();
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

function PlanPane({
  data,
  queue,
  setQueue,
  onDone,
}: {
  data: Board;
  queue: 'all' | 'today' | 'backlog' | 'waiting' | 'done';
  setQueue: (v: 'all' | 'today' | 'backlog' | 'waiting' | 'done') => void;
  onDone: () => Promise<void>;
}) {
  const planned = new Set(data.outcomes.map((item) => item.actionId));
  const shown = data.queue.filter((item) => {
    if (queue === 'today') return planned.has(item.id);
    if (queue === 'backlog') return item.state === 'OPEN' && !planned.has(item.id);
    if (queue === 'waiting') return item.state === 'SNOOZED';
    if (queue === 'done') return item.state === 'DONE';
    return item.state !== 'DONE';
  });
  const width = data.capacity.capacityMinutes ? Math.min(100, Math.round((data.capacity.plannedMinutes / data.capacity.capacityMinutes) * 100)) : 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric n={data.decisions.length} label="Decisions to review" hint="Open high-priority work" href="/today" />
        <Metric n={data.counts.openActions} label="Open actions" hint="Everything still to do" href="/today" />
        <Metric
          n={data.counts.possibleCollabs}
          label="Possible collaborations"
          hint="Not yet qualified"
          href="/collaborations?tab=inbox&triage=POSSIBLE&category=COLLABORATION&opportunity=none"
        />
        <Metric n={data.counts.scheduledToday} label="Posts scheduled today" hint="On the publishing calendar" href="/calendar" />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <div className="space-y-4">
          <Card title="Three outcomes for today" action={<span className="text-xs text-muted">{data.outcomes.filter((i) => i.state !== 'DONE').length} planned</span>}>
            <p className="mb-2 text-xs text-muted">Your short list. Removing one leaves the task in the queue.</p>
            {data.overPlan ? <p className="mb-2 text-sm text-[#c95c46]">More than three outcomes are on today. Finish or defer one.</p> : null}
            {data.outcomes.length === 0 ? <p className="text-sm text-muted">Add a task from the queue below.</p> : null}
            <ul className="divide-y divide-border">
              {data.outcomes.map((item) => (
                <li key={item.actionId} className="flex flex-wrap items-center gap-2 py-2">
                  <button
                    type="button"
                    className="size-11 rounded-lg border border-border text-sm"
                    aria-label={item.state === 'DONE' ? 'Reopen' : 'Complete'}
                    onClick={async () => {
                      await post(item.state === 'DONE' ? `/actions/${item.actionId}/reopen` : `/actions/${item.actionId}/complete`);
                      await onDone();
                    }}
                  >
                    {item.state === 'DONE' ? '↺' : '✓'}
                  </button>
                  <div className="min-w-0 flex-1">
                    <Link href={item.deepLink || `/today?action=${item.actionId}`} className="font-semibold hover:underline">
                      {item.title}
                    </Link>
                    <p className="text-xs text-muted">{item.nextAction || item.priority}</p>
                  </div>
                  <Input
                    className="w-20"
                    inputMode="numeric"
                    aria-label="Effort minutes"
                    defaultValue={item.effortMinutes ?? 25}
                    onBlur={async (e) => {
                      const effortMinutes = Number(e.target.value);
                      if (!Number.isFinite(effortMinutes)) return;
                      await patch(`/today/plan/items/${item.actionId}`, { effortMinutes });
                      await onDone();
                    }}
                  />
                  <button
                    type="button"
                    className="text-xs font-semibold text-muted"
                    onClick={async () => {
                      await del(`/today/plan/items/${item.actionId}`);
                      await onDone();
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Work queue">
            <div className="mb-2 flex flex-wrap gap-2">
              {(['all', 'today', 'backlog', 'waiting', 'done'] as const).map((item) => (
                <button key={item} type="button" className={`min-h-11 rounded-full px-3 text-xs font-semibold capitalize ${queue === item ? 'bg-[#203f34] text-white' : 'border border-border'}`} onClick={() => setQueue(item)}>
                  {item}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-border">
              {shown.map((item) => (
                <li key={item.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <Link href={item.deepLink || `/today?action=${item.id}`} className="font-medium hover:underline">{item.title}</Link>
                    <span className="mt-0.5 block text-xs text-muted">{item.reason || item.priority}</span>
                  </span>
                  {item.state === 'OPEN' && !planned.has(item.id) ? (
                    <button type="button" className="min-h-11 text-xs font-semibold text-[#203f34]" onClick={async () => { await post('/today/plan/items', { actionId: item.id }); await onDone(); }}>
                      Add to today
                    </button>
                  ) : null}
                </li>
              ))}
              {shown.length === 0 ? <li className="py-2 text-sm text-muted">Nothing in this list.</li> : null}
            </ul>
          </Card>
          <Card title="Needs your decision">
            {data.decisions.length === 0 ? <p className="text-sm text-muted">No high-priority decision is waiting.</p> : null}
            <ul className="divide-y divide-border">
              {data.decisions.map((item) => (
                <li key={item.id} className="py-2">
                  <Link href={item.href} className="font-semibold hover:underline">{item.title}</Link>
                  {item.detail ? <p className="text-xs text-muted">{item.detail}</p> : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Time you set aside">
            <p className="text-lg font-semibold leading-snug">
              {data.capacity.plannedMinutes === 0
                ? `${data.capacity.capacityMinutes} minutes are free. Nothing is planned yet.`
                : data.capacity.over
                  ? `${data.capacity.plannedMinutes} minutes planned. That is ${data.capacity.plannedMinutes - data.capacity.capacityMinutes} over the ${data.capacity.capacityMinutes} you set aside.`
                  : `${data.capacity.plannedMinutes} of ${data.capacity.capacityMinutes} minutes are planned. ${data.capacity.remainingMinutes} are still free.`}
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e7eee9]">
              <div className="h-full bg-[#203f34]" style={{ width: `${Math.max(width, data.capacity.plannedMinutes ? 4 : 0)}%` }} />
            </div>
            <Field label="Minutes you can focus today">
              <Input
                inputMode="numeric"
                defaultValue={data.capacity.capacityMinutes}
                onBlur={async (e) => {
                  const minutes = Number(e.target.value);
                  if (!Number.isFinite(minutes)) return;
                  await put('/today/capacity', { minutes });
                  await onDone();
                }}
              />
            </Field>
            <p className="text-xs text-muted">
              {data.calendarConnected ? 'Calendar times are included.' : 'No calendar is connected, so meetings are not checked against this.'}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {data.blocks.map((block) => (
                <li key={`${block.at}-${block.title}`}>{block.at ? new Date(block.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unscheduled'} · {block.title}</li>
              ))}
            </ul>
          </Card>
          <Card title="Publishing next">
            <Row label="Scheduled today" value={String(data.counts.scheduledToday)} href="/calendar" />
            <Row label="Unmatched posts" value={String(data.counts.unmatchedPublications)} href="/publishing?tab=unmatched" />
          </Card>
          <Card title="Operational exceptions">
            <Row label="Backup" value={data.health.backup ? `${data.health.backup.state}${data.health.backup.finishedAt ? '' : ' · not finished'}` : 'Not checked'} href="/settings" />
            <Row label="Offline devices" value={String(data.health.offlineDevices)} href="/storage" />
            <Row label="Workers needing a look" value={String(data.health.workersDown)} href="/comfy" />
            <Row label="Accounts to reconnect" value={String(data.health.authExpired)} href="/integrations" />
            <p className="mt-2 text-xs text-muted">Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
          </Card>
          <Card title="Continue where you stopped">
            {data.projects.length === 0 ? <p className="text-sm text-muted">No active project.</p> : null}
            <ul className="divide-y divide-border">
              {data.projects.map((project) => (
                <li key={project.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{project.title}</span>
                    <span className="block text-xs text-muted">{project.stage.replace(/_/g, ' ').toLowerCase()}</span>
                  </span>
                  <Link href={`/production/${project.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold">Continue</Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function FocusPane({
  data,
  remaining,
  note,
  setNote,
  onDone,
}: {
  data: Board;
  remaining: number;
  note: string;
  setNote: (v: string) => void;
  onDone: () => Promise<void>;
}) {
  const open = data.queue.filter((item) => item.state === 'OPEN');
  return (
    <section className="rounded-[22px] border border-border bg-panel p-5">
      <h2 className="font-serif text-2xl">Focus</h2>
      <p className="mt-1 text-sm text-muted">One task. The clock uses the start time, so leaving the app does not keep it running in the background.</p>
      <div className="mt-4 font-serif text-6xl tabular-nums">{data.focus ? clock(remaining) : '25:00'}</div>
      {data.focus && remaining === 0 ? <p className="mt-2 text-sm font-semibold">Session finished.</p> : null}
      <p className="mt-2 text-sm">{data.focus?.actionTitle || 'Choose a task to start.'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {open.slice(0, 6).map((item) => (
          <button key={item.id} type="button" className="min-h-11 rounded-full border border-border px-3 text-xs font-semibold" onClick={async () => { await post('/today/focus', { actionId: item.id, minutes: 25 }); await onDone(); }}>
            {item.title}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {[15, 25, 50].map((minutes) => (
          <button key={minutes} type="button" className="min-h-11 rounded-full bg-[#203f34] px-3 text-sm font-semibold text-white" disabled={!data.focus?.actionId && open.length === 0} onClick={async () => {
            const actionId = data.focus?.actionId || open[0]?.id;
            if (!actionId) return;
            await post('/today/focus', { actionId, minutes });
            await onDone();
          }}>
            {minutes} min
          </button>
        ))}
        <Button onClick={async () => { await post('/today/focus/pause'); await onDone(); }}>Pause</Button>
        <Button onClick={async () => { await post('/today/focus/resume'); await onDone(); }}>Resume</Button>
        <Button onClick={async () => { await post('/today/focus/reset'); await onDone(); }}>Reset</Button>
      </div>
      <Field label="Resume note">
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Button onClick={async () => { await put('/today/focus/note', { note }); await onDone(); }}>Save note</Button>
    </section>
  );
}

function ReviewPane({
  data,
  notes,
  setNotes,
  carry,
  setCarry,
  onDone,
}: {
  data: Board;
  notes: string;
  setNotes: (v: string) => void;
  carry: string[];
  setCarry: (ids: string[]) => void;
  onDone: () => Promise<void>;
}) {
  const done = data.outcomes.filter((item) => item.state === 'DONE');
  const left = data.outcomes.filter((item) => item.state !== 'DONE');
  return (
    <section className="rounded-[22px] border border-border bg-panel p-5">
      <h2 className="font-serif text-2xl">Review</h2>
      <p className="mt-1 text-sm text-muted">Saved for {data.today}. Unfinished work stays put unless you carry it forward.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Metric n={data.outcomes.length} label="Planned" />
        <Metric n={done.length} label="Completed" />
        <Metric n={left.length} label="Remaining" />
      </div>
      <ul className="mt-3 divide-y divide-border">
        {left.map((item) => (
          <li key={item.actionId} className="flex items-center gap-2 py-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={carry.includes(item.actionId)}
              onChange={(e) => setCarry(e.target.checked ? [...carry, item.actionId] : carry.filter((id) => id !== item.actionId))}
            />
            <span>{item.title}</span>
          </li>
        ))}
      </ul>
      <Field label="Notes">
        <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={async () => { await put('/today/review', { notes, checks: data.review.checks ?? {} }); await onDone(); }}>Save review</Button>
        <Button
          variant="primary"
          onClick={async () => {
            if (carry.length) await post('/today/review/carry', { actionIds: carry });
            await onDone();
            setCarry([]);
          }}
        >
          Carry selected to tomorrow
        </Button>
      </div>
    </section>
  );
}

function Metric({ n, label, hint, href }: { n: number; label: string; hint?: string; href?: string }) {
  const body = (
    <>
      <div className="font-serif text-3xl">{n}</div>
      <div className="text-sm font-semibold">{label}</div>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </>
  );
  const className = 'block rounded-[18px] border border-border bg-panel p-4 hover:border-[#203f34]';
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[18px] border border-border bg-panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <span>{label}</span>
      <span className="font-semibold">{value}</span>
    </Link>
  );
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that photo.'));
    reader.readAsDataURL(blob);
  });
}

function paintBanner(img: HTMLImageElement, mode: 'fit' | 'crop', focus: number, zoom: number, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (mode === 'fit') {
    const cover = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    ctx.filter = 'blur(32px)';
    ctx.drawImage(img, (w - img.naturalWidth * cover) / 2, (h - img.naturalHeight * cover) / 2, img.naturalWidth * cover, img.naturalHeight * cover);
    ctx.filter = 'none';
    const contain = Math.min(w / img.naturalWidth, h / img.naturalHeight) * 0.92;
    ctx.drawImage(img, (w - img.naturalWidth * contain) / 2, (h - img.naturalHeight * contain) / 2, img.naturalWidth * contain, img.naturalHeight * contain);
    return;
  }
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
  const sw = w / scale;
  const sh = h / scale;
  const sx = Math.max(0, (img.naturalWidth - sw) / 2);
  const sy = Math.max(0, img.naturalHeight - sh) * focus;
  ctx.drawImage(img, sx, sy, Math.min(sw, img.naturalWidth), Math.min(sh, img.naturalHeight), 0, 0, w, h);
}

export function BannerEditor({
  source,
  busy,
  onClose,
  onSave,
}: {
  source: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (banner: string) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ y: number; focus: number } | null>(null);
  const [mode, setMode] = useState<'fit' | 'crop'>('fit');
  const [focus, setFocus] = useState(0.35);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!source) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) paintBanner(img, mode, focus, zoom, canvas);
    };
    img.src = source;
  }, [source, mode, focus, zoom]);

  return (
    <Dialog
      open={Boolean(source)}
      onClose={onClose}
      title="Make a banner"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              void onSave(canvas.toDataURL('image/jpeg', 0.86));
            }}
          >
            Save banner
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Fit keeps the whole photo. Crop fills the banner. On Today, the area right of the line is the photo beside the heading, so drag the person into that side.</p>
      <div className="relative mt-3">
      <canvas
        ref={canvasRef}
        width={1600}
        height={500}
        className="w-full cursor-grab touch-none rounded-xl bg-[#203f34]"
        onPointerDown={(e) => {
          if (mode !== 'crop') return;
          drag.current = { y: e.clientY, focus };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const next = drag.current.focus + (e.clientY - drag.current.y) / 220;
          setFocus(Math.min(1, Math.max(0, next)));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[42%] border-l border-white/80" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={`min-h-11 rounded-full px-4 text-sm font-semibold ${mode === 'fit' ? 'bg-[#203f34] text-white' : 'border border-border'}`} onClick={() => setMode('fit')}>
          Fit
        </button>
        <button type="button" className={`min-h-11 rounded-full px-4 text-sm font-semibold ${mode === 'crop' ? 'bg-[#203f34] text-white' : 'border border-border'}`} onClick={() => setMode('crop')}>
          Crop
        </button>
        {mode === 'crop' ? (
          <label className="flex min-w-40 flex-1 items-center gap-2 text-sm">
            Zoom
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full" />
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}
