'use client';

import { useEffect, useState } from 'react';
import { ApiError, patch, post, refresh, useApi } from '@/lib/api';
import { Button, Notice } from '@/components/ui';
import { CHATGPT_PLAN } from '@creatoros/domain';

const NOTICE = 'Pictures for Gemini may be billable. A Gemini app subscription does not pay for the API. Nothing is published, and MiniMax is not started.';

function useAiTools() {
  const status = useApi<{ settings?: { enabled?: boolean } }>('/ai/status');
  return !!status.data && status.data.settings?.enabled !== false;
}

export function AiSwitch() {
  const status = useApi<{ settings?: { enabled?: boolean } }>('/ai/status');
  if (!status.data) return null;
  const enabled = status.data.settings?.enabled !== false;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1 text-sm"
      onClick={() => {
        void patch('/ai/settings', { enabled: !enabled }).then(() => refresh('/ai/status'));
      }}
    >
      <span className={enabled ? 'size-2 rounded-full bg-emerald-500' : 'size-2 rounded-full bg-zinc-400'} aria-hidden />
      AI {enabled ? 'On' : 'Off'}
    </button>
  );
}

type PromptFields = {
  imagePrompt: string;
  videoPrompt: string;
  cameraDirection: string;
  lighting: string;
  lipSyncNotes: string;
  avoidanceInstructions: string;
};

export function AiPromptTools({
  targetType,
  targetId,
  mode,
  currentPrompt,
  context,
  onApply,
}: {
  targetType: 'long_scene' | 'h3';
  targetId: string;
  mode: 'vocal' | 'broll';
  currentPrompt: string;
  context: Record<string, unknown>;
  onApply: (videoPrompt: string) => void;
}) {
  const on = useAiTools();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<PromptFields | null>(null);
  const [history, setHistory] = useState<PromptFields[]>([]);
  const blocked = true;
  const run = (task: 'scene_prompt_generate' | 'scene_prompt_improve' | 'scene_prompt_variations') => {
    if (blocked) return;
    setBusy(true);
    setError(null);
    post<{ versions: { imagePrompt: string; videoPrompt: string; fields: PromptFields }[] }>('/ai/prompts', {
      task,
      targetType,
      targetId,
      acceptBillable: true,
      idempotencyKey: crypto.randomUUID(),
      scene: { ...context, mode, currentPrompt },
    })
      .then((data) => {
        const first = data.versions[0];
        if (!first) throw new ApiError(502, 'EMPTY', 'No prompt came back.');
        setDraft(first.fields ?? first);
        setHistory(data.versions.map((row) => row.fields ?? row));
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const apply = (text: string) => {
    if (currentPrompt.trim() && currentPrompt.trim() !== text.trim()) {
      const ok = window.confirm('This scene already has a prompt. Replace it with the AI draft?');
      if (!ok) return;
    }
    onApply(text);
  };
  if (!on) return null;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-panel2 p-2">
      <p className="text-[11px] text-muted">{CHATGPT_PLAN.title} <a className="underline" href={CHATGPT_PLAN.interestForm} target="_blank" rel="noreferrer">Interest form</a>. Your typed prompt stays here. Kemokem will not send it through a paid OpenAI key.</p>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={busy || blocked} onClick={() => run('scene_prompt_generate')}>Generate prompt</Button>
        <Button size="sm" variant="ghost" disabled={busy || blocked || !currentPrompt.trim()} onClick={() => run('scene_prompt_improve')}>Improve prompt</Button>
        <Button size="sm" variant="ghost" disabled={busy || blocked} onClick={() => run('scene_prompt_variations')}>Variations</Button>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {draft ? (
        <div className="space-y-2 text-xs">
          <label className="block">Image prompt
            <textarea className="mt-1 min-h-16 w-full rounded-md border border-border bg-panel p-2 text-sm" value={draft.imagePrompt} onChange={(e) => setDraft({ ...draft, imagePrompt: e.target.value })} />
          </label>
          <label className="block">Video prompt
            <textarea className="mt-1 min-h-16 w-full rounded-md border border-border bg-panel p-2 text-sm" value={draft.videoPrompt} onChange={(e) => setDraft({ ...draft, videoPrompt: e.target.value })} />
          </label>
          <p className="text-muted">Camera: {draft.cameraDirection || '—'}</p>
          <p className="text-muted">Light: {draft.lighting || '—'}</p>
          {mode === 'vocal' ? <p className="text-muted">Lip-sync note: {draft.lipSyncNotes || 'A prompt does not lock the mouth to the song.'}</p> : null}
          <div className="flex flex-wrap gap-1">
            <Button size="sm" onClick={() => apply(draft.videoPrompt)}>Apply video prompt</Button>
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(draft.videoPrompt)}>Copy</Button>
          </div>
          {history.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {history.map((item, index) => (
                <Button key={index} size="sm" variant="ghost" onClick={() => setDraft(item)}>Version {index + 1}</Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AiImageTools({ projectId, sceneId, prompt }: { projectId: string; sceneId: string; prompt: string }) {
  const on = useAiTools();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ id: string; status: string; error?: string | null } | null>(null);
  const [assets, setAssets] = useState<{ id: string; model: string; prompt: string; width: number | null; height: number | null }[]>([]);
  const load = () => {
    setError(null);
    return import('@/lib/api').then(async ({ api }) => {
      setAssets(await api(`/ai/assets?sceneId=${sceneId}`));
      const jobs = await api<{ id: string; status: string; error?: string | null }[]>(`/ai/jobs?sceneId=${sceneId}`);
      if (jobs[0]) setJob(jobs[0]);
    }).catch((e: ApiError) => setError(e.message));
  };
  useEffect(() => {
    if (!on) return;
    void load();
  }, [sceneId, on]);
  useEffect(() => {
    if (!on || !job || (job.status !== 'QUEUED' && job.status !== 'RUNNING')) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, sceneId, on]);
  const generate = (mode: 'generate' | 'edit' | 'variation', sourceAssetId?: string) => {
    const ok = window.confirm('Generate one image with Gemini? Cost estimate unavailable — this may be billable. MiniMax will not start.');
    if (!ok) return;
    setBusy(true);
    setError(null);
    post<{ id: string; status: string; error?: string | null }>('/ai/images', {
      projectId,
      sceneId,
      mode,
      prompt: prompt || 'A realistic frame for this scene',
      sourceAssetId,
      acceptBillable: true,
      idempotencyKey: crypto.randomUUID(),
    })
      .then((row) => setJob(row))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setBusy(false));
  };
  if (!on) return null;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={busy} onClick={() => generate('generate')}>Generate image</Button>
        <Button size="sm" variant="ghost" onClick={() => load()}>Refresh images</Button>
      </div>
      {job ? <p className="text-xs text-muted">Image job {job.status}{job.error ? ` — ${job.error}` : ''}. The picture stays after a reload once it finishes.</p> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        {assets.map((asset) => (
          <figure key={asset.id} className="w-28 text-[10px] text-muted">
            <img src={`/api/v1/ai/assets/${asset.id}/file`} alt="" className="aspect-square w-full rounded-md object-cover" />
            <figcaption className="mt-1">{asset.width && asset.height ? `${asset.width}×${asset.height}` : 'Saved image'} · {asset.model}</figcaption>
            <Button size="sm" onClick={() => post(`/ai/assets/${asset.id}/attach`, {}).then(() => refresh(`/long-videos/${projectId}`)).catch((e: ApiError) => setError(e.message))}>Use on scene</Button>
            <Button size="sm" variant="ghost" onClick={() => generate('variation', asset.id)}>Variation</Button>
          </figure>
        ))}
      </div>
    </div>
  );
}

export function AiPublishAssistant({
  fileId,
  platform,
  title,
  caption,
  tags,
  onApplyTitle,
  onApplyCaption,
  onApplyTags,
}: {
  fileId?: string | null;
  platform: string;
  title: string;
  caption: string;
  tags: string;
  onApplyTitle: (value: string) => void;
  onApplyCaption: (value: string) => void;
  onApplyTags: (value: string) => void;
}) {
  const on = useAiTools();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<{ titles?: string[]; recommendedTitle?: string; description?: string; caption?: string; tags?: string[]; hashtags?: string[]; thumbnailConcept?: string; hook?: string; cta?: string } | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  if (!on) return null;
  if (!fileId) return <p className="text-xs text-muted">Link a video before asking Gemini to analyze it.</p>;
  const apply = (label: string, current: string, next: string, set: (value: string) => void) => {
    if (current.trim() && current.trim() !== next.trim() && !window.confirm(`Replace the current ${label}?`)) return;
    set(next);
  };
  return (
    <div className="space-y-2 rounded-lg border border-border bg-panel2 p-3">
      <h3 className="text-sm font-semibold">AI publishing assistant</h3>
      <p className="text-[11px] text-muted">{NOTICE} Applying a suggestion only fills this form. Publish stays on the button below.</p>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={busy} onClick={() => {
          if (!window.confirm('Send this video to Gemini for analysis? Cost estimate unavailable — this may be billable.')) return;
          setBusy(true);
          setError(null);
          post<{ id: string; status: string }>('/ai/analyze', { fileId, acceptBillable: true, idempotencyKey: crypto.randomUUID() })
            .then((job) => setJobNote(`Analysis ${job.status}. Refresh this panel after the worker finishes. Closing the page does not cancel a call that already started.`))
            .catch((e: ApiError) => setError(e.message))
            .finally(() => setBusy(false));
        }}>Analyze video</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
          setBusy(true);
          import('@/lib/api').then(({ api }) => api<{ status: string; output?: { analysis?: Record<string, unknown> }; error?: string }[]>(`/ai/jobs?targetType=library_file&targetId=${fileId}`))
            .then((jobs) => {
              const done = jobs.find((job) => job.status === 'COMPLETED' && job.output?.analysis);
              setAnalysis(done?.output?.analysis ?? null);
              setJobNote(done ? 'Analysis saved.' : jobs[0] ? `Latest analysis is ${jobs[0].status}. ${jobs[0].error ?? ''}` : 'No analysis yet.');
            })
            .catch((e: ApiError) => setError(e.message))
            .finally(() => setBusy(false));
        }}>Show analysis</Button>
        <Button size="sm" disabled={busy} onClick={() => {
          if (!window.confirm('Write publishing text from the saved analysis? This may be billable and will not replace your fields until you apply one.')) return;
          setBusy(true);
          post<{ draft: NonNullable<typeof draft> }>('/ai/metadata', { fileId, platform, acceptBillable: true })
            .then((row) => setDraft(row.draft))
            .catch((e: ApiError) => setError(e.message))
            .finally(() => setBusy(false));
        }}>Generate publishing details</Button>
      </div>
      {jobNote ? <p className="text-xs text-muted">{jobNote}</p> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {analysis ? (
        <div className="text-xs text-muted">
          <p>{String(analysis.summary ?? '')}</p>
          <p className="mt-1">Hook: {String(analysis.openingHook ?? '')}</p>
        </div>
      ) : null}
      {draft ? (
        <div className="space-y-2 text-xs">
          <p className="font-medium text-text">{draft.recommendedTitle}</p>
          {(draft.titles ?? []).map((item) => (
            <Button key={item} size="sm" variant="ghost" onClick={() => apply('title', title, item, onApplyTitle)}>{item}</Button>
          ))}
          <Button size="sm" onClick={() => apply('title', title, draft.recommendedTitle || '', onApplyTitle)}>Apply title</Button>
          <Button size="sm" variant="ghost" onClick={() => apply('description', caption, platform === 'youtube' ? draft.description || '' : draft.caption || draft.description || '', onApplyCaption)}>Apply description</Button>
          <Button size="sm" variant="ghost" onClick={() => apply('tags', tags, [...(draft.tags ?? []), ...(draft.hashtags ?? [])].join(', '), onApplyTags)}>Apply tags</Button>
          {draft.thumbnailConcept ? <p className="text-muted">Thumbnail idea: {draft.thumbnailConcept}</p> : null}
          {draft.hook ? <p className="text-muted">Hook: {draft.hook}</p> : null}
          {draft.cta ? <p className="text-muted">Call to action: {draft.cta}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
