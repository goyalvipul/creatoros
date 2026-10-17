'use client';

import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useMe } from '@/components/shell';
import { ActionButton, Async, Button, Card, CardTitle, Dialog, EmptyState, Field, FormDialog, Input, Notice, Options, PageHeader, Provenance, Select, StateBadge, Tabs } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { dateInput, title as titleCase, when } from '@/lib/format';
import { VARIANT_TYPES, useAccounts } from '@/lib/options';

const cellTone: Record<string, string> = {
  NOT_APPLICABLE: 'text-muted/50',
  PUBLISHED_VERIFIED: 'bg-ok/15 text-ok',
  PUBLISHED_MANUAL: 'bg-ok/10 text-ok',
  READY: 'bg-info/15 text-info',
  SCHEDULED: 'bg-info/15 text-info',
  PLANNED: 'bg-warn/15 text-warn',
  FAILED: 'bg-bad/15 text-bad',
};

/** Convert a datetime-local input value to the "plannedLocal" string the API expects (wall-clock in the owner's time zone). */
const localStamp = (v: string) => (v.length === 16 ? `${v}:00` : v);

export default function PublishingPage() {
  const [tab, setTab] = useState<'matrix' | 'unmatched'>('matrix');
  const matrix = useApi<any>('/publishing/matrix');
  const unmatched = useApi<any[]>('/publications/unmatched');
  const [cell, setCell] = useState<{ row: any; account: any; cell: any } | null>(null);
  const [addVariant, setAddVariant] = useState(false);
  const [existing, setExisting] = useState(false);

  return (
    <>
      <PageHeader
        title="Publishing"
        subtitle="Which piece of content is going to which account, and what is actually live. Creator OS never posts for you."
        actions={<><Button onClick={() => setExisting(true)}>Add a live post</Button><Button variant="primary" onClick={() => setAddVariant(true)}><Plus className="size-4" /> New variant</Button></>}
      />
      <Tabs tabs={[{ id: 'matrix', label: 'Plan' }, { id: 'unmatched', label: 'To match', badge: unmatched.data?.length ? <span className="rounded-full bg-warn/20 px-1.5 text-xs">{unmatched.data.length}</span> : undefined }]} value={tab} onChange={setTab} />

      {tab === 'matrix' && (
        <Async res={matrix}>
          {(m) =>
            m.rows.length === 0 ? (
              <EmptyState title="Nothing to plan yet" action={<Button variant="primary" onClick={() => setAddVariant(true)}>Create a variant</Button>}>A variant is a publishable version of an asset (a long video, a reel, a short). Plan each one per account.</EmptyState>
            ) : m.accounts.length === 0 ? (
              <Notice tone="warn" title="No social accounts yet">Add brands, channels and accounts in Channels first.</Notice>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead className="bg-panel2 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Content</th>
                      {m.accounts.map((a: any) => <th key={a.id} className="px-3 py-2 text-left font-medium"><div>{titleCase(a.platform)}</div><div className="font-normal">{a.handle}</div></th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-panel">
                    {m.rows.map((r: any) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2"><div className="font-medium">{r.title}</div><div className="text-xs text-muted">{titleCase(r.format)} · {r.assetTitle}</div></td>
                        {m.accounts.map((a: any) => {
                          const c = r.cells.find((x: any) => x.accountId === a.id) ?? { state: 'NOT_APPLICABLE' };
                          return (
                            <td key={a.id} className="px-2 py-2">
                              <button
                                aria-label={`${r.title} on ${a.platform} ${a.handle}: ${titleCase(c.state)}`}
                                className={clsx('w-full rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:border-accent', cellTone[c.state])}
                                onClick={() => setCell({ row: r, account: a, cell: c })}
                              >
                                {c.state === 'NOT_APPLICABLE' ? 'Not planned' : titleCase(c.state)}
                                {c.plannedAt && c.state !== 'PUBLISHED_MANUAL' && c.state !== 'PUBLISHED_VERIFIED' && <div className="opacity-80">{when(c.plannedAt, undefined, false)}</div>}
                                {c.publishedAt && <div className="opacity-80">{when(c.publishedAt, undefined, false)}</div>}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      )}

      {tab === 'unmatched' && (
        <Async res={unmatched} empty={<EmptyState title="Nothing to match">Posts discovered on your accounts that are not linked to a variant appear here.</EmptyState>}>
          {(rows) => <ul className="space-y-2">{rows.map((r) => <li key={r.id} className="rounded-xl border border-border bg-panel p-3 text-sm"><div className="font-medium">{r.title ?? r.canonicalUrl ?? 'Untitled post'}</div><div className="text-xs text-muted">{titleCase(r.platform)} {r.handle} · {r.publishedAt ? when(r.publishedAt) : ''}</div></li>)}</ul>}
        </Async>
      )}

      {cell && <CellDialog ctx={cell} onClose={() => setCell(null)} />}
      <VariantDialog open={addVariant} onClose={() => setAddVariant(false)} />
      <ExistingDialog open={existing} onClose={() => setExisting(false)} />
    </>
  );
}

function VariantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const assets = useApi<any[]>('/assets', { query: { limit: 200 } });
  const [f, setF] = useState({ assetId: '', titleMaster: '', type: 'MASTER' });
  return (
    <FormDialog open={open} onClose={onClose} title="New variant" submitLabel="Create" onSubmit={async () => {
      await post('/variants', { assetId: f.assetId, titleMaster: f.titleMaster.trim(), type: f.type });
      setF({ assetId: '', titleMaster: '', type: 'MASTER' });
      await refresh('/publishing', '/variants');
    }}>
      <Field label="Asset"><Select required value={f.assetId} onChange={(e) => setF({ ...f, assetId: e.target.value })}><option value="">Choose…</option>{(assets.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>
      <Field label="Title"><Input required value={f.titleMaster} onChange={(e) => setF({ ...f, titleMaster: e.target.value })} /></Field>
      <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><Options values={VARIANT_TYPES} /></Select></Field>
      {assets.data?.length === 0 && <p className="text-sm text-warn">Create an asset first in Library → Assets.</p>}
    </FormDialog>
  );
}

function ExistingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useAccounts();
  const [f, setF] = useState({ socialAccountId: '', url: '', title: '', publishedLocal: '' });
  return (
    <FormDialog open={open} onClose={onClose} title="Add a post that is already live" submitLabel="Add" onSubmit={async () => {
      await post('/publications/existing', { socialAccountId: f.socialAccountId, url: f.url.trim(), title: f.title.trim() || undefined, publishedLocal: f.publishedLocal ? localStamp(f.publishedLocal) : undefined });
      setF({ socialAccountId: '', url: '', title: '', publishedLocal: '' });
      await refresh('/publishing', '/publications', '/analytics', '/calendar');
    }}>
      <p className="text-sm text-muted">Records that this was published, as entered by you. It is not marked as verified until a platform connection confirms it.</p>
      <Field label="Account"><Select required value={f.socialAccountId} onChange={(e) => setF({ ...f, socialAccountId: e.target.value })}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{titleCase(a.platform)} {a.handle}</option>)}</Select></Field>
      <Field label="Link to the post"><Input required type="url" placeholder="https://…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Published on"><Input type="datetime-local" max={dateInput(new Date()) + 'T23:59'} value={f.publishedLocal} onChange={(e) => setF({ ...f, publishedLocal: e.target.value })} /></Field>
      </div>
    </FormDialog>
  );
}

function CellDialog({ ctx, onClose }: { ctx: { row: any; account: any; cell: any }; onClose: () => void }) {
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const { row, account, cell } = ctx;
  const rec = useApi<any>(cell.recordId ? `/publications/${cell.recordId}` : null);
  const [when_, setWhen] = useState('');
  const [url, setUrl] = useState('');
  const [evidence, setEvidence] = useState('');
  const [m, setM] = useState({ views: '', likes: '', comments: '', shares: '', saves: '', impressions: '' });
  const [warn, setWarn] = useState<string[]>([]);
  const reload = async () => { await refresh('/publishing', '/publications', '/calendar', '/analytics', '/briefing'); };
  const state = rec.data?.state ?? cell.state;
  const done = state === 'PUBLISHED_MANUAL' || state === 'PUBLISHED_VERIFIED';
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  return (
    <Dialog open onClose={onClose} title={`${row.title} → ${titleCase(account.platform)} ${account.handle}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><StateBadge state={state} />{rec.data && <Provenance value={rec.data.stateProvenance} />}{rec.data?.canonicalUrl && <a className="text-sm text-accent" href={rec.data.canonicalUrl} target="_blank" rel="noreferrer">Open post ↗</a>}</div>

        {!cell.recordId && (
          <Card>
            <CardTitle>Plan this post</CardTitle>
            <Field label="Planned for (your local time)"><Input type="datetime-local" value={when_} onChange={(e) => setWhen(e.target.value)} /></Field>
            {warn.length > 0 && <div className="mt-2"><Notice tone="warn" title="Check before planning">{warn.join(' ')}</Notice></div>}
            <div className="mt-3"><ActionButton variant="primary" onAction={async () => {
              const r = await post('/publications', { socialAccountId: account.id, variantId: row.id, title: row.title, plannedLocal: when_ ? localStamp(when_) : undefined, plannedTimezone: tz, state: 'PLANNED' });
              if (r.warnings?.length) setWarn(r.warnings.map((w: any) => w.message ?? String(w)));
              await reload();
              onClose();
            }} success="Planned">Plan</ActionButton></div>
          </Card>
        )}

        {cell.recordId && rec.data && !done && (
          <>
            <Card>
              <CardTitle>Schedule</CardTitle>
              <p className="mb-2 text-sm text-muted">{rec.data.plannedAt ? `Planned ${when(rec.data.plannedAt, rec.data.plannedTimezone ?? tz)}` : 'No date set.'} Creator OS only reminds you; it does not post.</p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="New date & time"><Input type="datetime-local" value={when_} onChange={(e) => setWhen(e.target.value)} /></Field>
                <ActionButton disabled={!when_} onAction={async () => { await post(`/publications/${cell.recordId}/reschedule`, { plannedLocal: localStamp(when_), timezone: tz }); await rec.mutate(); await reload(); }} success="Rescheduled">Reschedule</ActionButton>
                {state !== 'READY' && <ActionButton onAction={async () => { await post(`/publications/${cell.recordId}/transition`, { to: 'READY' }); await rec.mutate(); await reload(); }}>Mark ready</ActionButton>}
              </div>
            </Card>
            <Card>
              <CardTitle>I published it</CardTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Link to the live post"><Input type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
                <Field label="Note (optional)"><Input value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton variant="primary" onAction={async () => { await post(`/publications/${cell.recordId}/mark-published`, { url: url.trim() || undefined, evidence: evidence.trim() || undefined }); await reload(); onClose(); }} success="Marked as published (entered by you)">Mark as published</ActionButton>
                <ActionButton confirm="Mark this as failed?" onAction={async () => { await post(`/publications/${cell.recordId}/transition`, { to: 'FAILED', failureReason: evidence.trim() || undefined }); await rec.mutate(); await reload(); }}>Mark failed</ActionButton>
              </div>
            </Card>
          </>
        )}

        {cell.recordId && rec.data && done && (
          <Card>
            <CardTitle>Statistics</CardTitle>
            {rec.data.metrics.length > 0 ? (
              <ul className="mb-3 space-y-1 text-sm">
                {[...rec.data.metrics].reverse().slice(0, 3).map((x: any) => <li key={x.id}>{when(x.snapshotAt, tz)} — {x.views ?? '—'} views, {x.likes ?? '—'} likes, {x.comments ?? '—'} comments <Provenance value={x.provenance} /></li>)}
              </ul>
            ) : <p className="mb-3 text-sm text-muted">No statistics recorded. Numbers you type in are labelled “Entered by you”.</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(['views', 'likes', 'comments', 'shares', 'saves', 'impressions'] as const).map((k) => <Field key={k} label={titleCase(k)}><Input type="number" min={0} value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} /></Field>)}
            </div>
            <div className="mt-3"><ActionButton variant="primary" onAction={async () => { await post(`/publications/${cell.recordId}/metrics`, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, num(v)]).filter(([, v]) => v !== undefined))); await rec.mutate(); await reload(); }} success="Saved">Save statistics</ActionButton></div>
          </Card>
        )}

        {rec.data?.events?.length > 0 && (
          <details className="text-sm"><summary className="cursor-pointer text-muted">History</summary><ul className="mt-2 space-y-1">{rec.data.events.map((e: any) => <li key={e.id} className="text-xs text-muted">{when(e.at, tz)} · {titleCase(e.type ?? e.kind ?? 'event')}{e.toState ? ` → ${titleCase(e.toState)}` : ''}</li>)}</ul></details>
        )}
      </div>
    </Dialog>
  );
}

