'use client';

import clsx from 'clsx';
import { COUNT_DEFINITIONS } from '@creatoros/domain';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Copy, FileVideo, Film, FileAudio, FileImage, File as FileIcon, Plus, Search } from 'lucide-react';
import { useMe } from '@/components/shell';
import { ActionButton, Async, Badge, Button, Card, CardTitle, DefinitionTip, Dialog, EmptyState, Field, FormDialog, Input, KV, Notice, Options, PageHeader, Select, Spinner, Stat, StateBadge, Table, Tabs, Td, useToast } from '@/components/ui';
import { del, post, put, refresh, useApi } from '@/lib/api';
import { ago, bytes, copy, title as titleCase, when } from '@/lib/format';
import { ASSET_KINDS, useBrands, useRoots } from '@/lib/options';

const KINDS = ['VIDEO', 'AUDIO', 'IMAGE', 'DOCUMENT', 'PROJECT', 'OTHER'];
const AVAIL = ['AVAILABLE', 'DEVICE_OFFLINE', 'ROOT_UNREACHABLE', 'MISSING_CANDIDATE', 'CONFIRMED_MISSING', 'PERMISSION_DENIED', 'INCOMPLETE'];
const kindIcon = { VIDEO: FileVideo, AUDIO: FileAudio, IMAGE: FileImage, DOCUMENT: FileIcon, PROJECT: Film, OTHER: FileIcon } as const;

export default function LibraryPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Library />
    </Suspense>
  );
}

function Library() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<'files' | 'duplicates' | 'assets'>('files');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [availability, setAvailability] = useState('');
  const [rootId, setRootId] = useState('');
  const [linked, setLinked] = useState(sp.get('linked') ?? '');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const counts = useApi<any>('/library/counts', { refreshInterval: 30_000 });
  const roots = useRoots();

  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setCursors([undefined]); };
  const filters = { q: q.trim() || undefined, kind: kind || undefined, availability: availability || undefined, rootId: rootId || undefined, linked: linked || undefined };

  return (
    <>
      <PageHeader title="Library" subtitle="Everything your scanner agents have indexed. Files stay where they are; this is a read-only catalogue." />
      <Async res={counts}>
        {(c) => (
          <section aria-label="Library counts" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={<>Physical files<DefinitionTip text={COUNT_DEFINITIONS.physicalInstances} /></>} value={c.total} />
            <Stat label="Available now" value={c.byAvailability?.AVAILABLE ?? 0} tone="ok" />
            <Stat label={<>Exact duplicate groups<DefinitionTip text={COUNT_DEFINITIONS.exactMediaObjects} /></>} value={c.duplicateGroups} />
            <Stat label="Media not linked to an asset" value={c.unlinkedMedia} tone={c.unlinkedMedia ? 'warn' : undefined} />
          </section>
        )}
      </Async>

      <Tabs tabs={[{ id: 'files', label: 'Files' }, { id: 'duplicates', label: 'Duplicates' }, { id: 'assets', label: 'Assets' }]} value={tab} onChange={setTab} />

      {tab === 'files' && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
              <Input aria-label="Search files" placeholder="Search name or path" className="w-64 pl-8" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
            </div>
            <Select aria-label="Kind" value={kind} onChange={(e) => reset(setKind)(e.target.value)}><Options values={KINDS} none="Any kind" /></Select>
            <Select aria-label="Availability" value={availability} onChange={(e) => reset(setAvailability)(e.target.value)}><Options values={AVAIL} none="Any availability" /></Select>
            <Select aria-label="Folder" value={rootId} onChange={(e) => reset(setRootId)(e.target.value)}>
              <option value="">Any folder</option>
              {(roots.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
            <Select aria-label="Linked" value={linked} onChange={(e) => reset(setLinked)(e.target.value)}>
              <option value="">Linked or not</option><option value="true">Linked to an asset</option><option value="false">Not linked</option>
            </Select>
          </div>
          {cursors.map((c, i) => (
            <FilePage key={`${i}-${JSON.stringify(filters)}`} filters={filters} cursor={c} first={i === 0} onOpen={setOpenFile} onMore={(n) => setCursors((cs) => (cs.length === i + 1 ? [...cs, n] : cs))} last={i === cursors.length - 1} />
          ))}
        </>
      )}
      {tab === 'duplicates' && <Duplicates onOpen={setOpenFile} />}
      {tab === 'assets' && <Assets />}
      {openFile && <FileDetail id={openFile} onClose={() => setOpenFile(null)} />}
    </>
  );
}

function FilePage({ filters, cursor, first, last, onOpen, onMore }: { filters: Record<string, unknown>; cursor?: string; first: boolean; last: boolean; onOpen: (id: string) => void; onMore: (c: string) => void }) {
  const res = useApi<{ items: any[]; nextCursor: string | null }>('/library', { query: { ...filters, cursor, limit: 50 } });
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  return (
    <Async res={res}>
      {(page) => (
        <>
          {first && page.items.length === 0 && <EmptyState title="No files match">Pair a PC and add a folder in Storage & Devices, or loosen the filters.</EmptyState>}
          {page.items.length > 0 && (
            <ul className={clsx('divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel', !first && 'mt-px')}>
              {page.items.map((f) => {
                const Icon = kindIcon[f.fileType as keyof typeof kindIcon] ?? FileIcon;
                return (
                  <li key={f.id}>
                    <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-panel2" onClick={() => onOpen(f.id)}>
                      {f.hasPreview ? <img src={`/api/v1/files/${f.id}/preview`} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" /> : <span className="grid size-10 shrink-0 place-items-center rounded bg-panel2 text-muted"><Icon className="size-5" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{f.fileName}</span>
                        <span className="block truncate text-xs text-muted">{f.deviceName} · {f.rootLabel} · {bytes(f.size)} · {when(f.mtime, tz, false)}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StateBadge state={f.effectiveAvailability} />
                        {f.otherCopies > 0 && <Badge tone="info">{f.otherCopies + 1} copies</Badge>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {last && page.nextCursor && <div className="mt-3 text-center"><Button onClick={() => onMore(page.nextCursor!)}>Load more</Button></div>}
        </>
      )}
    </Async>
  );
}

function FileDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const res = useApi<any>(`/files/${id}`);
  const sugg = useApi<any[]>(`/files/${id}/suggestions`);
  const toast = useToast();
  const [tags, setTags] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const f = res.data;
  const playable = f && (f.fileType === 'VIDEO' || f.fileType === 'AUDIO') && f.effectiveAvailability === 'AVAILABLE';
  const reload = () => refresh(`/files/${id}`, '/library');
  return (
    <Dialog open onClose={onClose} title={f?.fileName ?? 'File'} wide>
      <Async res={res}>
        {(file) => (
          <div className="space-y-4">
            {file.effectiveAvailability !== 'AVAILABLE' && (
              <Notice tone={file.effectiveAvailability === 'DEVICE_OFFLINE' ? 'info' : 'warn'} title={titleCase(file.effectiveAvailability)}>
                {file.effectiveAvailability === 'DEVICE_OFFLINE' ? 'The PC holding this file is offline. It is temporarily unavailable, not missing.' : file.effectiveAvailability === 'MISSING_CANDIDATE' ? 'It was not found in the last full scan. It will be confirmed missing only after repeated complete scans.' : 'This file cannot be opened right now.'}
              </Notice>
            )}
            {playable && (file.fileType === 'VIDEO' ? <video className="max-h-80 w-full rounded-lg bg-black" controls preload="metadata" src={`/api/v1/files/${id}/stream`} /> : <audio className="w-full" controls preload="metadata" src={`/api/v1/files/${id}/stream`} />)}
            {!playable && file.hasPreview && <img alt="" className="max-h-64 rounded-lg" src={`/api/v1/files/${id}/preview`} />}

            <Card>
              <CardTitle>Where it lives</CardTitle>
              <ul className="space-y-2 text-sm">
                {([['Original path', file.copyPaths.local], ['SMB / network path', file.copyPaths.smb], ['Server mount path', file.copyPaths.mount]] as const).map(([label, p]) => p && (
                  <li key={label} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1"><div className="text-xs text-muted">{label}</div><code className="block break-all text-xs">{p}</code></div>
                    <Button size="sm" aria-label={`Copy ${label}`} onClick={async () => { await copy(p); toast.ok('Path copied'); }}><Copy className="size-4" /></Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">Paste the path into Explorer or your editing tool. Creator OS never moves, renames or deletes this file.</p>
            </Card>

            <Card>
              <CardTitle>Details</CardTitle>
              <KV items={[['Device', file.deviceName], ['Folder', file.rootLabel], ['Size', bytes(file.size)], ['Type', `${titleCase(file.fileType)}${file.mime ? ` (${file.mime})` : ''}`], ['Modified', when(file.mtime)], ['First seen', ago(file.firstSeenAt)], ['Probe', titleCase(file.probeState)], ['Fingerprint', file.fullHash ? <code className="break-all text-xs">sha256 {file.fullHash.slice(0, 24)}…</code> : 'Not fully hashed (provisional identity)'], ...(file.tech ? Object.entries(file.tech).slice(0, 8).map(([k, v]) => [titleCase(k), String(v)] as [string, string]) : [])]} />
            </Card>

            {file.copies.length > 0 && (
              <Card>
                <CardTitle>Identical copies ({file.copies.length})</CardTitle>
                <ul className="space-y-1 text-sm">{file.copies.map((c: any) => <li key={c.id}><span className="text-xs text-muted">{c.deviceName}</span> <code className="break-all text-xs">{c.displayPath}</code> <StateBadge state={c.effectiveAvailability} /></li>)}</ul>
              </Card>
            )}

            <Card>
              <CardTitle action={<Button size="sm" onClick={() => setLinking(true)}>Link to asset</Button>}>Linked assets</CardTitle>
              {file.assets.length === 0 ? <p className="text-sm text-muted">Not linked to any asset yet.</p> : <ul className="space-y-1 text-sm">{file.assets.map((a: any) => <li key={a.versionId}>{a.title} <span className="text-muted">· {a.versionLabel}</span> <Badge>{a.linkReason}</Badge></li>)}</ul>}
              <div className="mt-3 border-t border-border pt-3">
                <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">Suggestions</span><ActionButton size="sm" onAction={async () => { await post(`/files/${id}/suggestions`, {}); await sugg.mutate(); }}>Find matches</ActionButton></div>
                {(sugg.data ?? []).filter((s) => !s.outcome || s.outcome === 'PENDING').length === 0 ? <p className="text-xs text-muted">No pending suggestions. Suggestions are never linked automatically.</p> : (
                  <ul className="space-y-2">
                    {(sugg.data ?? []).filter((s) => !s.outcome || s.outcome === 'PENDING').map((s) => (
                      <li key={s.id} className="rounded-lg border border-border p-2 text-sm">
                        <div className="font-medium">{s.title} <span className="text-xs font-normal text-muted">{Math.round(s.confidence * 100)}% match</span></div>
                        <div className="text-xs text-muted">{(s.reasons ?? []).join(' · ')}</div>
                        <div className="mt-2 flex gap-2">
                          <ActionButton size="sm" variant="primary" onAction={async () => { await post(`/suggestions/${s.id}/accept`, {}); await reload(); await sugg.mutate(); }} success="Linked">Accept</ActionButton>
                          <ActionButton size="sm" onAction={async () => { await post(`/suggestions/${s.id}/reject`, {}); await sugg.mutate(); }}>Reject</ActionButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card>
              <CardTitle>Tags</CardTitle>
              <div className="mb-2 flex flex-wrap gap-1.5">{file.tags.length === 0 ? <span className="text-sm text-muted">No tags.</span> : file.tags.map((t: any) => <Badge key={t.id} tone="info">{t.name}</Badge>)}</div>
              <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const next = [...file.tags.map((t: any) => t.name), ...(tags ?? '').split(',').map((s) => s.trim()).filter(Boolean)]; try { await put(`/files/${id}/tags`, { tags: [...new Set(next)] }); setTags(''); await reload(); } catch (err) { toast.error(err); } }}>
                <Input aria-label="Add tags" placeholder="Add tags, comma separated" value={tags ?? ''} onChange={(e) => setTags(e.target.value)} />
                <Button type="submit">Add</Button>
              </form>
            </Card>
          </div>
        )}
      </Async>
      {linking && <LinkToAsset fileId={id} onClose={() => setLinking(false)} onLinked={reload} />}
    </Dialog>
  );
}

function LinkToAsset({ fileId, onClose, onLinked }: { fileId: string; onClose: () => void; onLinked: () => unknown }) {
  const assets = useApi<any[]>('/assets', { query: { limit: 200 } });
  const [assetId, setAssetId] = useState('');
  const detail = useApi<any>(assetId ? `/assets/${assetId}` : null);
  const [versionId, setVersionId] = useState('');
  return (
    <FormDialog open onClose={onClose} title="Link file to an asset version" submitLabel="Link" onSubmit={async () => { await post(`/versions/${versionId}/files`, { fileInstanceId: fileId, reason: 'manual' }); await onLinked(); onClose(); }}>
      <Field label="Asset"><Select required value={assetId} onChange={(e) => { setAssetId(e.target.value); setVersionId(''); }}><option value="">Choose…</option>{(assets.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>
      {assetId && <Field label="Version"><Select required value={versionId} onChange={(e) => setVersionId(e.target.value)}><option value="">Choose…</option>{(detail.data?.versions ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.label} ({titleCase(v.variantType)})</option>)}</Select></Field>}
    </FormDialog>
  );
}

function Duplicates({ onOpen }: { onOpen: (id: string) => void }) {
  const exact = useApi<any[]>('/duplicates/exact');
  const cand = useApi<any[]>('/duplicates/candidates', { query: { state: 'SUGGESTED' } });
  return (
    <div className="space-y-5">
      <Notice tone="info" title="Nothing is merged or deleted for you">Duplicates are shown so you can decide. Exact duplicates share the same content fingerprint; “possible” ones are only similar by name, size or duration.</Notice>
      <Card>
        <CardTitle action={<ActionButton size="sm" onAction={async () => { await post('/duplicates/detect', {}); await refresh('/duplicates'); }} success="Duplicate check queued">Re-check</ActionButton>}>Exact duplicates</CardTitle>
        <Async res={exact} empty={<p className="text-sm text-muted">No exact duplicates found.</p>}>
          {(groups) => (
            <ul className="space-y-3">
              {groups.map((g) => (
                <li key={g.mediaObjectId} className="rounded-lg border border-border p-3">
                  <div className="mb-1 text-sm font-medium">{g.copies} copies · {bytes(g.size)} each · <span className="text-warn">{bytes(g.wastedBytes)} reclaimable</span></div>
                  <ul className="space-y-1">{g.files.map((f: any) => <li key={f.id} className="flex items-center gap-2 text-xs"><button className="min-w-0 flex-1 truncate text-left text-accent hover:underline" onClick={() => onOpen(f.id)}>{f.displayPath}</button><span className="text-muted">{f.deviceName}</span></li>)}</ul>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
      <Card>
        <CardTitle>Possible duplicates</CardTitle>
        <Async res={cand} empty={<p className="text-sm text-muted">No suggestions to review.</p>}>
          {(rows) => (
            <ul className="space-y-3">
              {rows.map((c) => (
                <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2"><Badge>{titleCase(c.method)}</Badge><span className="text-xs text-muted">{Math.round(c.score * 100)}% similar · {(c.reasons ?? []).join(', ')}</span></div>
                  {[c.a, c.b].map((side: any[] | null, i) => <div key={i} className="truncate text-xs"><code>{side?.[0]?.path ?? '—'}</code> <span className="text-muted">{bytes(side?.[0]?.size)}</span></div>)}
                  <div className="mt-2 flex gap-2">
                    <ActionButton size="sm" onAction={async () => { await post(`/duplicates/candidates/${c.id}/review`, { state: 'CONFIRMED' }); await cand.mutate(); }}>Same content</ActionButton>
                    <ActionButton size="sm" onAction={async () => { await post(`/duplicates/candidates/${c.id}/review`, { state: 'DISMISSED' }); await cand.mutate(); }}>Not a duplicate</ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
    </div>
  );
}

function Assets() {
  const [q, setQ] = useState('');
  const assets = useApi<any[]>('/assets', { query: { q: q || undefined, limit: 200 } });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const brands = useBrands();
  const [f, setF] = useState({ title: '', kind: 'VIDEO', brandId: '' });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input aria-label="Search assets" placeholder="Search assets" className="w-64" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="primary" className="ml-auto" onClick={() => setAdding(true)}><Plus className="size-4" /> New asset</Button>
      </div>
      <Async res={assets} empty={<EmptyState title="No assets yet">An asset is one intended piece of content (a song, a video). It can have many versions and many file copies.</EmptyState>}>
        {(rows) => (
          <Table head={['Asset', 'Kind', 'State', 'Versions', 'Files']}>
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-panel2">
                <Td><button className="text-left font-medium text-accent hover:underline" onClick={() => setOpen(a.id)}>{a.title}</button></Td>
                <Td>{titleCase(a.kind)}</Td><Td><StateBadge state={a.creativeState} /></Td><Td>{a.versionCount}</Td><Td>{a.fileCount}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Async>
      {open && <AssetDetail id={open} onClose={() => setOpen(null)} />}
      <FormDialog open={adding} onClose={() => setAdding(false)} title="New asset" submitLabel="Create" onSubmit={async () => { await post('/assets', { title: f.title.trim(), kind: f.kind, brandId: f.brandId || undefined }); setF({ title: '', kind: 'VIDEO', brandId: '' }); await refresh('/assets'); }}>
        <Field label="Title"><Input required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><Options values={ASSET_KINDS} /></Select></Field>
          <Field label="Brand"><Select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}><option value="">None</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        </div>
      </FormDialog>
    </>
  );
}

function AssetDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const res = useApi<any>(`/assets/${id}`);
  const reload = () => refresh(`/assets`);
  return (
    <Dialog open onClose={onClose} title={res.data?.title ?? 'Asset'} wide>
      <Async res={res}>
        {(a) => (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5"><StateBadge state={a.creativeState} /><Badge>{titleCase(a.kind)}</Badge>{a.isDemo && <Badge tone="info">demo</Badge>}</div>
            <h3 className="text-sm font-semibold">Versions</h3>
            <ul className="space-y-2">
              {a.versions.map((v: any) => (
                <li key={v.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{v.label}</span><Badge>{titleCase(v.variantType)}</Badge>{v.isMaster && <Badge tone="info">master</Badge>}
                    {a.selectedVersionId === v.id && <Badge tone="ok">selected final</Badge>}
                    {a.selectedVersionId !== v.id && <ActionButton size="sm" className="ml-auto" confirm="Mark this version as the selected final?" onAction={async () => { await post(`/assets/${id}/select-version`, { versionId: v.id }); await refresh(`/assets/${id}`); await reload(); }}>Select as final</ActionButton>}
                  </div>
                  {v.intendedUse && <div className="mt-1 text-xs text-muted">For {v.intendedUse}</div>}
                  <ul className="mt-2 space-y-1">{v.files.map((f: any) => <li key={f.id} className="flex items-center gap-2 text-xs"><code className="min-w-0 flex-1 break-all">{f.displayPath ?? f.fileName}</code><ActionButton size="sm" confirm="Unlink this file from the version? The file itself is untouched." onAction={async () => { await del(`/versions/${v.id}/files/${f.id}`); await refresh(`/assets/${id}`); }}>Unlink</ActionButton></li>)}{v.files.length === 0 && <li className="text-xs text-muted">No files linked.</li>}</ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Async>
    </Dialog>
  );
}
