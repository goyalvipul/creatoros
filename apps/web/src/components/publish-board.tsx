'use client';

import clsx from 'clsx';
import { Calendar, Eye, Link2, MoreHorizontal, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { FileDownload } from '@/components/file-download';
import { PublishFields } from '@/components/publish-fields';
import { VideoThumb } from '@/components/video-thumb';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  FormDialog,
  Input,
  Notice,
  Select,
} from '@/components/ui';
import { ApiError, api, del, post, qs, refresh, useApi } from '@/lib/api';
import { bytes, title as titleCase, when } from '@/lib/format';
import { PlatformLogo } from '@/components/platform-logo';
import { useRoots } from '@/lib/options';

function ratioLabel(width?: number | null, height?: number | null) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return '';
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(Math.round(w), Math.round(h));
  return `${Math.round(w) / d}:${Math.round(h) / d}`;
}

function clock(ms?: number | null) {
  const n = Number(ms);
  if (!(n > 0)) return '';
  const s = Math.round(n / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function VariantBoard({
  rows,
  accounts,
  tz,
}: {
  rows: any[];
  accounts: any[];
  tz?: string;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (!needle) return true;
      return [r.title, r.projectTitle, r.assetTitle, r.brandName].some((v) =>
        String(v ?? '').toLowerCase().includes(needle),
      );
    });
    return [...list].sort((a, b) =>
      sort === 'title'
        ? String(a.title).localeCompare(String(b.title))
        : String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')),
    );
  }, [rows, q, sort]);
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of shown) {
      const key = row.projectTitle || row.assetTitle || 'Ungrouped';
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [shown]);

  if (rows.length === 0) {
    return (
      <EmptyState title="No publishing variants yet">
        A variant is one publishable title. Attach its videos, then schedule each file on its own.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search variants or projects"
          placeholder="Search variants or projects"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'title')}>
          <option value="recent">Recently updated</option>
          <option value="title">Title</option>
        </Select>
        <p className="ml-auto text-xs text-muted">
          {shown.length} variant{shown.length === 1 ? '' : 's'} · grouped by project
        </p>
      </div>
      {groups.map(([project, items]) => (
        <div key={project} className="space-y-3">
          {items.map((row) => (
            <VariantCard key={row.id} row={row} project={project} accounts={accounts} tz={tz} />
          ))}
        </div>
      ))}
    </div>
  );
}

function VariantCard({
  row,
  project,
  accounts,
  tz,
}: {
  row: any;
  project: string;
  accounts: any[];
  tz?: string;
}) {
  const [open, setOpen] = useState(false);
  const detail = useApi<any>(open ? `/variants/${row.id}/publish` : null);
  return (
    <article className="rounded-2xl border border-border bg-panel p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-56 shrink-0 self-center">
          <p className="text-[10px] font-semibold tracking-wide text-muted">PROJECT · {String(project).toUpperCase()}</p>
          <Link href={`/publishing/${row.id}`} className="block truncate text-lg font-semibold hover:underline">
            {row.title}
          </Link>
          <p className="text-xs text-muted">
            Variant / {titleCase(row.format)}
            {row.brandName ? ` · ${row.brandName}` : ''}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge>{row.attached} file{row.attached === 1 ? '' : 's'}</Badge>
            {row.scheduled > 0 ? <Badge tone="ok">{row.scheduled} scheduled</Badge> : null}
            {row.attached > 0 && row.scheduled === 0 ? <Badge tone="warn">Needs scheduling</Badge> : null}
          </div>
        </div>
        <CardThumbs variantId={row.id} seeded={Array.isArray(row.previews) ? row.previews : null} />
        <ul className="ml-auto hidden gap-4 text-xs sm:flex">
          {accounts.map((a) => {
            const cell = (row.cells ?? []).find((c: any) => c.accountId === a.id);
            return (
              <li key={a.id} className="text-center">
                <PlatformLogo platform={a.platform} className="mx-auto size-6" />
                <div className="text-muted">
                  {Math.min(cell?.active ?? cell?.published ?? 0, row.attached)}/{row.attached} active
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2">
          <Button onClick={() => setOpen((v) => !v)}>
            {open ? `Hide videos (${row.attached})` : `Show videos (${row.attached})`}
          </Button>
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Calendar className="size-4" /> Schedule files
          </Button>
        </div>
      </div>
      {open && (
        <Async res={detail}>
          {(data) => <FileList variantId={row.id} data={data} tz={tz} />}
        </Async>
      )}
    </article>
  );
}

function CardThumbs({ variantId, seeded }: { variantId: string; seeded: string[] | null }) {
  const detail = useApi<{ items?: { fileInstanceId?: string | null }[] }>(
    seeded ? null : `/variants/${variantId}/publish`,
  );
  const ids = seeded ?? (detail.data?.items ?? []).map((item) => item.fileInstanceId).filter((id): id is string => Boolean(id)).slice(0, 4);
  if (!seeded && !detail.data && !detail.error) {
    return <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-panel2" />;
  }
  return <ThumbStrip ids={ids} />;
}

function ThumbStrip({ ids }: { ids: string[] }) {
  if (ids.length === 0) {
    return <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-panel2 text-xs text-muted">—</span>;
  }
  return (
    <div className="flex h-16 shrink-0 items-center">
      {ids.slice(0, 4).map((id, i) => (
        <span
          key={id}
          className="relative block size-16 shrink-0 overflow-hidden rounded-lg border-2 border-panel bg-panel2"
          style={{ marginLeft: i === 0 ? 0 : -14 }}
        >
          <VideoThumb fileId={id} interactive={false} compact className="size-full" />
        </span>
      ))}
    </div>
  );
}

function FileList({ variantId, data, tz }: { variantId: string; data: any; tz?: string }) {
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [actions, setActions] = useState<any | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">Videos attached to this variant</h3>
          <p className="text-xs text-muted">Each file has separate status and scheduling for each platform.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setLinkOpen(true)}>
            <Link2 className="size-4" /> Link indexed
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" /> Upload new
          </Button>
        </div>
      </div>
      {data.items.length === 0 ? (
        <EmptyState title="No videos attached">Link a file already on a PC, or upload one into a scanned folder.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {data.items.map((item: any) => (
            <li key={item.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="relative inline-block size-14 shrink-0 overflow-hidden rounded-lg bg-panel2">
                  <VideoThumb
                    fileId={item.fileInstanceId}
                    online={item.deviceState === 'ONLINE'}
                    interactive={false}
                    compact
                    className="size-full"
                  />
                  {clock(item.durationMs) ? (
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[10px] text-white">
                      {clock(item.durationMs)}
                    </span>
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/publishing/${variantId}?file=${item.id}`} className="font-medium hover:underline">
                    {item.fileName}
                  </Link>
                  <p className="text-xs text-muted">
                    {[
                      ratioLabel(item.width, item.height),
                      bytes(item.size),
                      item.deviceName,
                      item.deviceState === 'ONLINE' ? 'Available' : 'Offline',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <ul className="flex flex-wrap gap-1">
                  {data.accounts.map((account: any) => {
                    const draft = (data.drafts as any[]).find(
                      (d) => d.itemId === item.id && d.accountId === account.id,
                    );
                    return (
                      <li key={account.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]">
                        <PlatformLogo platform={account.platform} className="size-3.5" />
                        {draft ? draftLabel(draft.uploadState) : '—'}
                      </li>
                    );
                  })}
                </ul>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={`/publishing/${variantId}?file=${item.id}`} className="inline-flex">
                    <Button>
                      <Eye className="size-4" /> Preview
                    </Button>
                  </Link>
                  <Button variant="primary" onClick={() => setScheduleId(scheduleId === item.id ? null : item.id)}>
                    <Calendar className="size-4" /> Schedule
                  </Button>
                  {item.deviceState === 'ONLINE' && (
                    <FileDownload
                      icon
                      href={`/api/v1/files/${item.fileInstanceId}/stream?download=1`}
                      name={item.fileName}
                    />
                  )}
                  <Button aria-label={`Actions for ${item.fileName}`} className="size-10 px-0" onClick={() => setActions(item)}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </div>
              </div>
              {scheduleId === item.id && (
                <QuickSchedule
                  variantId={variantId}
                  item={item}
                  accounts={data.accounts}
                  drafts={data.drafts}
                  tz={tz}
                  onClose={() => setScheduleId(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">
        Originals remain on their source PCs. Unlinking is not deleting. Publishing always requires your explicit confirmation.
      </p>
      {linkOpen && (
        <LinkDialog variantId={variantId} onClose={() => setLinkOpen(false)} />
      )}
      {uploadOpen && <UploadDialog variantId={variantId} onClose={() => setUploadOpen(false)} />}
      {actions && (
        <FileActions
          variantId={variantId}
          item={actions}
          onClose={() => setActions(null)}
        />
      )}
    </div>
  );
}

function draftLabel(state: string) {
  if (state === 'SCHEDULED') return 'Scheduled';
  if (state === 'PUBLISHED') return 'Published';
  if (state === 'QUEUED' || state === 'UPLOADING') return 'Sending';
  if (state === 'FAILED') return 'Failed';
  if (state === 'DRAFT') return 'Draft';
  return titleCase(state);
}

function QuickSchedule({
  variantId,
  item,
  accounts,
  drafts,
  tz,
  onClose,
}: {
  variantId: string;
  item: any;
  accounts: any[];
  drafts: any[];
  tz?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const usable = accounts.filter((a) => a.platform !== 'tiktok');
  const [accountId, setAccountId] = useState(usable[0]?.id ?? '');
  const account = usable.find((a) => a.id === accountId);
  const draft = drafts.find((d) => d.itemId === item.id && d.accountId === accountId);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [confirm, setConfirm] = useState(false);
  const zone = (tz ?? 'America/Vancouver').split('/').pop()?.replace(/_/g, ' ');
  const openEditor = () => router.push(`/publishing/${variantId}?file=${item.id}&account=${accountId}`);
  return (
    <div className="mt-3 rounded-xl border border-border bg-panel2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">Quick schedule · {item.fileName}</p>
          <p className="text-xs text-muted">Uses the saved post details when they exist. YouTube still needs a title, type, and privacy, so that opens the full form.</p>
        </div>
        <Button aria-label="Close schedule" onClick={onClose}>
          ×
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Destination account">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {usable.map((a) => (
              <option key={a.id} value={a.id}>
                {titleCase(a.platform)} {a.handle}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Publish date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={`Time (${zone})`}>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      {account && !account.canPublish && (
        <p className="mt-2 text-xs text-warn">{account.reason} Nothing will be sent.</p>
      )}
      <p className="mt-2 text-xs text-muted">Nothing is sent now. At the time you confirm, Creator OS posts this file only if the account can publish.</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={openEditor}>Open full editor</Button>
        <Button
          variant="primary"
          disabled={!date || !time || !account}
          onClick={() => {
            if (account?.platform === 'youtube' && (!draft?.title || !draft?.privacy || !draft?.contentForm || !draft?.aiUse)) {
              openEditor();
              return;
            }
            if (account?.platform === 'threads' && (!draft?.aiUse || !['everyone', 'accounts_you_follow', 'followers_only', 'mentioned_only'].includes(draft?.privacy))) {
              openEditor();
              return;
            }
            if (account?.platform === 'tiktok' && !['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(draft?.privacy)) {
              openEditor();
              return;
            }
            setConfirm(true);
          }}
        >
          Review schedule
        </Button>
      </div>
      {confirm && account && (
        <ConfirmSchedule
          variantId={variantId}
          item={item}
          account={account}
          draft={draft}
          whenLocal={`${date}T${time}`}
          tz={tz}
          onClose={() => setConfirm(false)}
          onDone={onClose}
        />
      )}
    </div>
  );
}

function ConfirmSchedule({
  variantId,
  item,
  account,
  draft,
  whenLocal,
  tz,
  onClose,
  onDone,
}: {
  variantId: string;
  item: any;
  account: any;
  draft?: any;
  whenLocal: string;
  tz?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title="Confirm schedule">
      <p className="text-sm">
        This saves the time. The file stays on the PC. It is sent at that time only if {account.handle} can publish.
        Nothing is posted now.
      </p>
      <dl className="mt-3 space-y-1 text-sm">
        <div>
          <dt className="inline text-muted">Video: </dt>
          <dd className="inline">{item.fileName}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Account: </dt>
          <dd className="inline">
            <PlatformLogo platform={account.platform} className="mr-1 inline size-4 align-text-bottom" />
            {account.handle}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted">When: </dt>
          <dd className="inline">
            {whenLocal.replace('T', ' ')} ({tz ?? 'America/Vancouver'})
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <ActionButton
          variant="primary"
          disabled={!account.canPublish}
          onAction={async () => {
            await post('/publishing/schedule', {
              itemId: item.id,
              socialAccountId: account.id,
              requestId: crypto.randomUUID(),
              title: draft?.title ?? null,
              caption: draft?.caption ?? null,
              hashtags: draft?.hashtags ?? [],
              privacy: draft?.privacy ?? (account.platform === 'youtube' ? null : 'PUBLIC'),
              contentForm: draft?.contentForm ?? null,
              playlistIds: draft?.playlistIds ?? [],
              aiUse: draft?.aiUse ?? null,
              plannedLocal: whenLocal.slice(0, 16),
              timezone: tz,
            });
            await refresh(`/variants/${variantId}/publish`, '/publishing/matrix');
            onDone();
          }}
          success="Scheduled"
        >
          Confirm schedule
        </ActionButton>
      </div>
    </Dialog>
  );
}

export function FileActions({
  variantId,
  item,
  onClose,
}: {
  variantId: string;
  item: any;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title="File actions">
      <p className="mb-3 text-sm text-muted">{item.fileName} · All operations remain separate.</p>
      <div className="grid gap-2">
        {item.deviceState === 'ONLINE' ? (
          <FileDownload href={`/api/v1/files/${item.fileInstanceId}/stream?download=1`} name={item.fileName} label="Download original" />
        ) : (
          <p className="text-sm text-muted">The PC is off, so the original cannot be downloaded right now.</p>
        )}
        <ActionButton
          className="h-10 w-full justify-start px-3"
          confirm="Unlink this video from the variant? The file and any post already sent stay."
          onAction={async () => {
            await del(`/variants/${variantId}/files/${item.id}`);
            await refresh(`/variants/${variantId}/publish`, '/publishing/matrix');
            onClose();
          }}
        >
          <Link2 className="size-4" /> Unlink from variant (keep original)
        </ActionButton>
        <Link
          href={`/library?file=${item.fileInstanceId}`}
          className="flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:border-accent"
        >
          <Eye className="size-4" /> Inspect source file
        </Link>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}

export function UploadDialog({ variantId, onClose }: { variantId: string; onClose: () => void }) {
  const roots = useRoots();
  const [rootId, setRootId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const choices = (roots.data ?? []).filter((r) => r.state === 'ACTIVE' && r.deviceState === 'ONLINE');
  return (
    <FormDialog
      open
      onClose={onClose}
      title="Upload a video to a PC"
      submitLabel="Upload and link"
      onSubmit={async () => {
        if (!file || !rootId) throw new ApiError(400, 'BAD_REQUEST', 'Choose a video and a folder on a PC that is on.');
        const res = await fetch(
          `/api/v1/variants/${variantId}/upload?rootId=${encodeURIComponent(rootId)}&name=${encodeURIComponent(file.name)}`,
          {
            method: 'POST',
            headers: { 'x-requested-with': 'creatoros', 'content-type': 'application/x-creatoros-file' },
            body: file,
          },
        );
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new ApiError(res.status, json?.error?.code ?? 'UPLOAD', json?.error?.message ?? 'The upload did not finish.');
        }
        await refresh(`/variants/${variantId}/publish`, '/publishing/matrix', '/library');
        onClose();
      }}
    >
      <p className="text-sm text-muted">
        The original file is copied, unchanged, into a folder that PC already indexes. It is not compressed. The PC has to be on, and its scanner has to be the current one.
      </p>
      <Field label="Video from this device">
        <input
          type="file"
          accept=".mp4,.mov,.mkv,.webm,.m4v,video/mp4,video/quicktime,video/webm"
          className="block w-full text-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label="Destination folder">
        <Select value={rootId} onChange={(e) => setRootId(e.target.value)}>
          <option value="">Choose a PC and folder</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.deviceName} · Online · {r.label}
            </option>
          ))}
        </Select>
      </Field>
      {roots.data && choices.length === 0 && (
        <p className="text-sm text-muted">No scanned folder has its PC on right now.</p>
      )}
    </FormDialog>
  );
}

export function LinkDialog({ variantId, onClose }: { variantId: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [extra, setExtra] = useState<{ q: string; items: any[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const files = useApi<{ items: any[]; nextCursor: string | null }>('/library', {
    query: { kind: 'VIDEO', q, limit: 50 },
  });
  const tail = extra && extra.q === q.trim() ? extra : null;
  const items = [...(files.data?.items ?? []), ...(tail?.items ?? [])];
  const next = tail ? tail.next : (files.data?.nextCursor ?? null);
  return (
    <FormDialog open onClose={onClose} title="Link a video" submitLabel="Close" onSubmit={async () => {}}>
      <p className="text-sm text-muted">Every video in the library. Search by file name or path.</p>
      <Field label="Search">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="File name or path" />
      </Field>
      <ul className="max-h-80 space-y-1 overflow-auto">
        {items.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className="w-full rounded-lg border border-border px-2 py-1.5 text-left text-sm hover:border-accent"
              onClick={async () => {
                await post(`/variants/${variantId}/files`, { fileInstanceId: f.id });
                await refresh(`/variants/${variantId}/publish`, '/publishing/matrix');
                onClose();
              }}
            >
              <span className="block truncate font-medium">{f.fileName}</span>
              <span className="block truncate text-xs text-muted">
                {f.deviceName} · {f.displayPath}
              </span>
            </button>
          </li>
        ))}
        {files.data && items.length === 0 && <li className="text-sm text-muted">No videos in the library match that search.</li>}
      </ul>
      {next ? (
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const page = await api<{ items: any[]; nextCursor: string | null }>(
                `/library${qs({ kind: 'VIDEO', q, limit: 50, cursor: next })}`,
              );
              setExtra({
                q: q.trim(),
                items: [...(tail?.items ?? []), ...(page.items ?? [])],
                next: page.nextCursor,
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          More videos
        </Button>
      ) : null}
    </FormDialog>
  );
}

export function ActivityList({
  rows,
  empty,
  tz,
}: {
  rows: any[];
  empty: string;
  tz?: string;
}) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
          <Link href={`/publishing/${row.variantId}?file=${row.itemId}`} className="min-w-0 flex-1 hover:underline">
            <span className="block truncate font-medium">{row.fileName}</span>
            <span className="block truncate text-xs text-muted">
              {row.title} · <PlatformLogo platform={row.platform} className="inline size-3.5 align-text-bottom" /> {row.handle}
            </span>
          </Link>
          <Badge>{draftLabel(row.uploadState)}</Badge>
          {row.scheduledAt ? <span className="text-xs text-muted">{when(row.scheduledAt, tz)}</span> : null}
          {row.error ? <span className="text-xs text-bad">{row.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function PublishStat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className={clsx('rounded-2xl border border-border bg-panel px-4 py-3')}>
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
