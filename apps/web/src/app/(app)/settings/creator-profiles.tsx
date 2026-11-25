'use client';

import { useEffect, useState } from 'react';
import { useMe } from '@/components/shell';
import { Button, Card, CardTitle, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { patch, put, useApi } from '@/lib/api';
import { useCatalog, type Brand } from '@/lib/options';

const sections = [
  { title: 'Identity', fields: [['name', 'Public name', 120], ['niche', 'Niche', 1000], ['characterName', 'Character name', 120]] },
  { title: 'Personality and voice', fields: [['languages', 'Languages', 200], ['tone', 'Tone', 1000], ['voice', 'Speaking and singing direction', 1000]] },
  { title: 'Creative direction', fields: [['themes', 'Themes', 1000], ['characterNotes', 'Canonical identity and proportions', 1000], ['visualNotes', 'Visual direction, environments and continuity', 1000], ['avoid', 'Avoid / guardrails', 1000]] },
  { title: 'Publishing context', fields: [['hashtags', 'Hashtags', 1000], ['links', 'Official links', 1000], ['disclosure', 'Internal disclosure instructions', 1000]] },
] as const;
const fields = sections.flatMap((section) => [...section.fields]);
type Profile = Record<string, unknown> & { brandId: string | null; referenceFileIds: string[] };
type LibraryFile = { id: string; fileName: string; fileType: string; effectiveAvailability?: string };

function normalize(value: Record<string, unknown> | null, brandId: string | null): Profile {
  const result: Profile = { brandId, referenceFileIds: [] };
  for (const [key] of fields) result[key] = typeof value?.[key] === 'string' ? value[key] : '';
  if (Array.isArray(value?.referenceFileIds)) result.referenceFileIds = value.referenceFileIds.filter((id): id is string => typeof id === 'string');
  return result;
}

function importProfile(raw: string, brandId: string | null): Profile {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a single profile JSON object.');
  const row = value as Record<string, unknown>;
  if ('brandId' in row && row.brandId !== brandId) throw new Error('This JSON belongs to another creator. Select that creator first.');
  for (const [key, label, limit] of fields) {
    if (key in row && (typeof row[key] !== 'string' || (row[key] as string).length > limit)) throw new Error(label + ' must be text, at most ' + limit + ' characters.');
  }
  if ('referenceFileIds' in row) {
    const refs = row.referenceFileIds;
    if (!Array.isArray(refs) || refs.length > 8 || new Set(refs).size !== refs.length || refs.some((id) => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error('Reference IDs must be unique UUIDs (maximum eight).');
  }
  return normalize(row, brandId);
}

export function CreatorProfiles({ initialBrandId }: { initialBrandId: string | null }) {
  const catalog = useCatalog();
  const owner = useMe().data?.user.role === 'OWNER';
  const [selected, setSelected] = useState(initialBrandId ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const brands = catalog.data ?? [];
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (catalog.error) return <Notice tone="bad">{catalog.error.message}</Notice>;
  if (!catalog.data) return <p className="text-sm text-muted">Loading creators…</p>;
  const brand = brands.find((b) => b.id === selected);
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Creator profiles</CardTitle>
        <p className="mb-3 text-sm text-muted">Each creator has independent context. The workspace default is only for unassigned work; it is not another creator's identity.</p>
        <Field label="Creator">
          <Select value={selected} disabled={saving} onChange={(event) => {
            if (dirty && !window.confirm('Discard unsaved creator changes?')) return;
            setDirty(false);
            setSelected(event.target.value);
          }}>
            <option value="">Workspace default</option>
            {brands.filter((b) => b.active !== false).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
      </Card>
      {selected && !brand ? <Notice tone="bad">Creator not found. Select an available creator.</Notice> : <ProfileEditor key={selected} brand={brand ?? null} owner={owner} onDirty={setDirty} onSaving={setSaving} onBrandSaved={() => void catalog.mutate()} />}
    </div>
  );
}

function ProfileEditor({ brand, owner, onDirty, onSaving, onBrandSaved }: { brand: Brand | null; owner: boolean; onDirty: (value: boolean) => void; onSaving: (value: boolean) => void; onBrandSaved: () => void }) {
  const brandId = brand?.id ?? null;
  const profile = useApi<Record<string, unknown> | null>('/ai/profile', { query: { brandId }, keepPreviousData: false });
  const [draft, setDraft] = useState<Profile | null>(null);
  const [brandDraft, setBrandDraft] = useState<{ description: string; pillars: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState<Profile | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const library = useApi<{ items: LibraryFile[]; nextCursor: string | null }>(owner ? '/library' : null, { query: { kind: 'IMAGE', availability: 'AVAILABLE', q: search, limit: 50 }, keepPreviousData: false });
  const dirty = draft !== null || brandDraft !== null;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  if (profile.error) return <Notice tone="bad">{profile.error.message}</Notice>;
  if (profile.data === undefined) return <p className="text-sm text-muted">Loading profile…</p>;
  const value = draft ?? normalize(profile.data, brandId);
  const brandValue = brandDraft ?? { description: brand?.description ?? '', pillars: (brand?.contentPillars ?? []).join('\n') };
  const update = (key: string, next: unknown) => setDraft({ ...value, [key]: next });
  const move = (index: number, delta: number) => {
    const refs = [...value.referenceFileIds];
    const target = index + delta;
    if (target < 0 || target >= refs.length) return;
    [refs[index], refs[target]] = [refs[target]!, refs[index]!];
    update('referenceFileIds', refs);
  };
  async function save() {
    setBusy(true);
    onSaving(true);
    setError('');
    setMessage('');
    try {
      if (draft) {
        const saved = await put<Record<string, unknown>>('/ai/profile', draft);
        await profile.mutate(saved, false);
        setDraft(null);
      }
      if (brand && brandDraft) {
        const pillars = brandDraft.pillars.split('\n').map((line) => line.trim()).filter(Boolean);
        if (pillars.length > 100 || pillars.some((line) => line.length > 200)) throw new Error('Use at most 100 content pillars, up to 200 characters each.');
        await patch('/brands/' + brand.id, { description: brandDraft.description || null, contentPillars: pillars });
        onBrandSaved();
        setBrandDraft(null);
      }
      setMessage('Saved creator profile.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save creator profile.');
    } finally {
      setBusy(false);
      onSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {brand && <Card>
        <CardTitle>Brand details — {brand.name}</CardTitle>
        <Field label="Description">
          <Textarea rows={3} maxLength={2000} disabled={!owner || busy} value={brandValue.description} onChange={(e) => setBrandDraft({ ...brandValue, description: e.target.value })} />
        </Field>
        <Field label="Content pillars (one per line)">
          <Textarea rows={4} disabled={!owner || busy} value={brandValue.pillars} onChange={(e) => setBrandDraft({ ...brandValue, pillars: e.target.value })} />
        </Field>
        <p className="text-xs text-muted">Connected accounts: {brand.channels.flatMap((c) => c.accounts).map((a) => a.platform + ': ' + a.handle).join(' · ') || 'None'}</p>
      </Card>}
      {sections.map((section) => <Card key={section.title}>
        <CardTitle>{section.title}</CardTitle>
        <div className="grid gap-3 md:grid-cols-2">
          {section.fields.map(([key, label, limit]) => <Field key={key} label={label}>
            <Textarea rows={limit <= 200 ? 2 : 5} maxLength={limit} disabled={!owner || busy} value={String(value[key] ?? '')} onChange={(e) => update(key, e.target.value)} />
            <span className="text-xs text-muted">{String(value[key] ?? '').length}/{limit}</span>
          </Field>)}
        </div>
      </Card>)}
      <Card>
        <CardTitle>Permanent image references ({value.referenceFileIds.length}/8)</CardTitle>
        <p className="mb-3 text-xs text-muted">First image is the recommended identity authority. Keep project wardrobe, scenes and locations separate. Reordering does not modify source files.</p>
        <div className="space-y-2">
          {value.referenceFileIds.map((id, index) => <div key={id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <img src={'/api/v1/files/' + id + '/stream'} alt={'Reference ' + (index + 1)} className="size-16 rounded object-cover" loading="lazy" />
            <span className="min-w-0 flex-1 break-all text-xs">{index === 0 ? 'Primary · ' : 'Supporting · '}{id}</span>
            {owner && <><Button size="sm" disabled={busy || index === 0} onClick={() => move(index, -1)}>Up</Button><Button size="sm" disabled={busy || index === value.referenceFileIds.length - 1} onClick={() => move(index, 1)}>Down</Button><Button size="sm" disabled={busy} onClick={() => update('referenceFileIds', value.referenceFileIds.filter((ref) => ref !== id))}>Remove</Button></>}
          </div>)}
        </div>
        {owner && <>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); }}>
            <Input aria-label="Search image library" placeholder="Search image filenames" maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button type="submit">Search</Button>
          </form>
          {library.error && <Notice tone="bad">{library.error.message}</Notice>}
          <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
            {(library.data?.items ?? []).map((file) => <div key={file.id} className="flex min-w-0 items-center gap-2 rounded border border-border p-2">
              <img src={'/api/v1/files/' + file.id + '/stream'} alt="" className="size-12 shrink-0 rounded object-cover" loading="lazy" />
              <span className="min-w-0 flex-1 break-all text-xs">{file.fileName}</span>
              <Button size="sm" disabled={busy || value.referenceFileIds.length >= 8 || value.referenceFileIds.includes(file.id)} onClick={() => update('referenceFileIds', [...value.referenceFileIds, file.id])}>Add</Button>
            </div>)}
          </div>
          {library.data?.nextCursor && <p className="text-xs text-muted">More matches exist. Narrow your filename search.</p>}
        </>}
      </Card>
      <Card>
        <CardTitle>Profile JSON</CardTitle>
        <Button size="sm" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = 'creator-profile-' + (brandId ?? 'default') + '.json';
          link.click();
          URL.revokeObjectURL(url);
        }}>Export JSON</Button>
        {owner && <>
          <Field label="Paste a creator profile JSON to preview">
            <Textarea rows={5} value={raw} disabled={busy} onChange={(e) => { setRaw(e.target.value); setPreview(null); }} />
          </Field>
          <Button size="sm" disabled={busy || !raw.trim()} onClick={() => {
            try { setPreview(importProfile(raw, brandId)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Invalid JSON.'); setPreview(null); }
          }}>Validate and preview</Button>
          {preview && <>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview, null, 2)}</pre>
            <Button disabled={busy} onClick={() => {
              if (!window.confirm('Replace the current profile draft with this JSON? Save is still required.')) return;
              setDraft(preview);
              setPreview(null);
              setRaw('');
            }}>Apply to draft</Button>
          </>}
        </>}
      </Card>
      {owner && <div className="sticky bottom-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel p-3">
        <Button variant="primary" busy={busy} disabled={!dirty || busy} onClick={() => void save()}>Save changes</Button>
        <Button disabled={!dirty || busy} onClick={() => { setDraft(null); setBrandDraft(null); setPreview(null); setError(''); setMessage(''); }}>Cancel changes</Button>
        <span className="text-xs text-muted">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
      </div>}
    </div>
  );
}
