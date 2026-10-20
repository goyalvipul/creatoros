'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CreativeFields, RichEditor, creativeFrom, creativePayload, type CreativeForm } from '@/components/creative-fields';
import { Button, ErrorNote, Field, Input, Options, PageHeader, Select, Spinner } from '@/components/ui';
import { patch, post, refresh, useApi } from '@/lib/api';
import { blankIdea, clearIdeaDraft, readIdeaDraft, writeIdeaDraft, type IdeaFormState } from '@/lib/idea-draft';
import { IDEA_FORMATS, PRIORITIES, useBrands } from '@/lib/options';

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fromIdea(idea: {
  title?: string | null;
  pitch?: string | null;
  format?: string | null;
  priority?: string | null;
  brandId?: string | null;
  conceptDetail?: string | null;
}): IdeaFormState {
  const creative = creativeFrom(idea);
  if (!creative.conceptDetail && idea.pitch) creative.conceptDetail = `<p>${escapeHtml(idea.pitch)}</p>`;
  return {
    title: idea.title ?? '',
    format: idea.format ?? 'OTHER',
    priority: idea.priority ?? 'NORMAL',
    brandId: idea.brandId ?? '',
    ...creative,
  };
}

export function IdeaEditor({ ideaId }: { ideaId: string }) {
  const router = useRouter();
  const brands = useBrands();
  const isNew = ideaId === 'new';
  const existing = useApi<any>(isNew ? null : `/ideas/${ideaId}`);
  const [form, setForm] = useState<IdeaFormState | null>(null);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (!isNew && !existing.data) return;
    started.current = true;
    const draft = readIdeaDraft(ideaId);
    setForm(draft ?? (isNew ? blankIdea() : fromIdea(existing.data)));
    setRestored(Boolean(draft));
  }, [ideaId, isNew, existing.data]);

  const update = (next: IdeaFormState) => {
    setForm(next);
    writeIdeaDraft(ideaId, next);
  };

  const save = async () => {
    if (!form || !form.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: form.title.trim(),
        pitch: null,
        format: form.format,
        priority: form.priority,
        brandId: form.brandId || null,
        ...creativePayload(form),
      };
      if (isNew) await post('/ideas', body);
      else await patch(`/ideas/${ideaId}`, body);
      clearIdeaDraft(ideaId);
      await refresh('/ideas');
      router.push('/content');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!isNew && existing.error && !existing.data) return <ErrorNote error={existing.error} retry={() => void existing.mutate()} />;
  if (!form) return <Spinner />;

  return (
    <form
      className="mx-auto max-w-3xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-sm">
        <Link href="/content" className="text-accent">
          ← Content ideas
        </Link>
      </p>
      <PageHeader
        title={isNew ? 'New idea' : 'Edit idea'}
        subtitle="Writing stays on this browser until you capture it, even if you close the app."
      />
      {restored && (
        <p className="rounded-lg border border-border bg-panel2 px-3 py-2 text-sm">
          Restored your unsaved writing from this browser.
        </p>
      )}
      {!isNew && existing.data?.convertedProjectId && (
        <p className="text-xs text-muted">
          This idea already has a project. Saving here does not change that project. Edit the project in Production.
        </p>
      )}
      {error ? <ErrorNote error={error} /> : null}
      <Field label="Title">
        <Input required autoFocus value={form.title} onChange={(e) => update({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Detailed concept">
        <RichEditor
          key={ideaId}
          tall
          value={form.conceptDetail}
          onChange={(conceptDetail) => update({ ...form, conceptDetail })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Format">
          <Select value={form.format} onChange={(e) => update({ ...form, format: e.target.value })}>
            <Options values={IDEA_FORMATS} />
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={(e) => update({ ...form, priority: e.target.value })}>
            <Options values={PRIORITIES} />
          </Select>
        </Field>
      </div>
      <Field label="Brand">
        <Select value={form.brandId} onChange={(e) => update({ ...form, brandId: e.target.value })}>
          <option value="">No brand yet</option>
          {brands.map((b: { id: string; name: string }) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <CreativeFields
        formKey={`${ideaId}-rest`}
        showConcept={false}
        value={form}
        onChange={(next: CreativeForm) => update({ ...form, ...next })}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          onClick={() => {
            clearIdeaDraft(ideaId);
            router.push('/content');
          }}
        >
          Discard
        </Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!form.title.trim()}>
          {isNew ? 'Capture' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
