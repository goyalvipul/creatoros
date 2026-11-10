'use client';

import { useState } from 'react';
import { AI_IMAGE_MODELS, AI_TEXT_MODELS, BILLING_NOTE, CHATGPT_PLAN } from '@creatoros/domain';
import { ApiError, patch, post, useApi } from '@/lib/api';
import { AiSwitch } from '@/components/ai-tools';
import { Button, Card, CardTitle, Field, Input, Notice, Select } from '@/components/ui';

type Status = {
  openai: string;
  gemini: string;
  credentialSource: string;
  billingNote: string;
  settings: Record<string, string | number | boolean>;
  usage: Record<string, { day: number; month: number }>;
  lastJob: { task: string; status: string; error: string | null } | null;
};

export function AiProviders() {
  const status = useApi<Status>('/ai/status');
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const settings = status.data?.settings;
  const save = (body: Record<string, unknown>) => {
    setError(null);
    patch('/ai/settings', body).then(() => status.mutate()).catch((e: ApiError) => setError(e.message));
  };
  const check = (provider: 'openai' | 'gemini') => {
    setTest(null);
    post<{ state: string; seen: string[]; selectedAvailable: boolean; error?: string; billingNote: string }>('/ai/providers/test', { provider })
      .then((row) => setTest(`${provider}: ${row.state}. Models this account listed: ${row.seen.join(', ') || 'none of the supported ids'}. Selected model available: ${row.selectedAvailable ? 'yes' : 'no'}. ${row.error ?? row.billingNote}`))
      .catch((e: ApiError) => setError(e.message));
  };
  if (!settings) return <p className="text-sm text-muted">Loading AI settings…</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Off hides the prompt, image, and publishing AI buttons. Settings stay here.</p>
        <AiSwitch />
      </div>
      <Notice>{BILLING_NOTE} Gemini keys stay on the server. This page never shows them. Prompt writing does not use a paid OpenAI API key.</Notice>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {test ? <Notice>{test}</Notice> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardTitle>ChatGPT Plan</CardTitle>
          <p className="mt-1 text-sm">Use eligible ChatGPT-plan allowance for supported prompt writing. No OpenAI API key is required once OpenAI approves this app.</p>
          <Notice>{CHATGPT_PLAN.title}</Notice>
          <p className="text-xs text-muted">Kemokem is a private app on the public internet. OpenAI currently allows ChatGPT-plan usage for open-source tools, local personal projects, and selected private apps. This deployment is not one of those until they approve it.</p>
          <a className="mt-2 inline-block text-sm underline" href={CHATGPT_PLAN.interestForm} target="_blank" rel="noreferrer">OpenAI interest form</a>
        </Card>
        <Card>
          <CardTitle>Google Gemini</CardTitle>
          <p className="mt-1 text-sm text-muted">{status.data?.gemini} · {status.data?.credentialSource}</p>
          <p className="text-xs text-muted">Images today {status.data?.usage.image?.day ?? 0} / {String(settings.dailyImageLimit)} · Videos {status.data?.usage.video?.day ?? 0} / {String(settings.dailyVideoLimit)}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => check('gemini')}>Test connection</Button>
            <Button size="sm" variant="ghost" onClick={() => save({ geminiEnabled: !settings.geminiEnabled })}>{settings.geminiEnabled ? 'Disable' : 'Enable'}</Button>
          </div>
          <Field label="Image model">
            <Select value={String(settings.imageModel)} onChange={(e) => save({ imageModel: e.target.value })}>
              {AI_IMAGE_MODELS.map((model) => <option key={model}>{model}</option>)}
            </Select>
          </Field>
          <Field label="Video and metadata model">
            <Select value={String(settings.videoModel)} onChange={(e) => save({ videoModel: e.target.value, metadataModel: e.target.value })}>
              {AI_TEXT_MODELS.map((model) => <option key={model}>{model}</option>)}
            </Select>
          </Field>
          <Field label="Image aspect">
            <Select value={String(settings.imageAspect)} onChange={(e) => save({ imageAspect: e.target.value })}>
              {['16:9', '9:16', '1:1', '4:5', '3:2', '4:3', '21:9'].map((ratio) => <option key={ratio}>{ratio}</option>)}
            </Select>
          </Field>
          <Field label="Image size">
            <Select value={String(settings.imageSize)} onChange={(e) => save({ imageSize: e.target.value })}>
              <option>1K</option>
              <option>2K</option>
            </Select>
          </Field>
        </Card>
      </div>
      <Card>
        <CardTitle>Limits</CardTitle>
        <p className="mt-1 text-xs text-muted">Counts use the America/Vancouver day and month. They are not a provider invoice. A failed call that reached the provider counts.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            ['dailyImageLimit', 'Images per day'],
            ['monthlyImageLimit', 'Images per month'],
            ['dailyVideoLimit', 'Video analyses per day'],
            ['monthlyVideoLimit', 'Video analyses per month'],
            ['dailyPromptLimit', 'Prompts per day'],
            ['dailyMetadataLimit', 'Metadata requests per day'],
          ] as const).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input type="number" defaultValue={String(settings[key] ?? 0)} onBlur={(e) => save({ [key]: Number(e.target.value) })} />
            </Field>
          ))}
        </div>
        {status.data?.lastJob ? <p className="mt-3 text-xs text-muted">Last request: {status.data.lastJob.task} · {status.data.lastJob.status}{status.data.lastJob.error ? ` · ${status.data.lastJob.error}` : ''}</p> : null}
      </Card>
      <CreatorProfile />
    </div>
  );
}

function CreatorProfile() {
  const profile = useApi<Record<string, string> | null>('/ai/profile');
  const [error, setError] = useState<string | null>(null);
  const row = profile.data ?? {};
  return (
    <Card>
      <CardTitle>Creator voice</CardTitle>
      <p className="mt-1 text-xs text-muted">Used as context for prompts and captions. It does not describe a face. Reference pictures do that.</p>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {(['name', 'niche', 'tone', 'voice', 'characterName', 'characterNotes', 'avoid', 'links'] as const).map((key) => (
        <Field key={key} label={key}>
          <Input defaultValue={row[key] ?? ''} onBlur={(e) => {
            import('@/lib/api').then(({ put }) => put('/ai/profile', { ...row, [key]: e.target.value })).then(() => profile.mutate()).catch((err: ApiError) => setError(err.message));
          }} />
        </Field>
      ))}
    </Card>
  );
}
