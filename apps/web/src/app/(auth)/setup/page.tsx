'use client';

import clsx from 'clsx';
import { CheckCircle2, Circle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { post, put, refresh, useApi } from '@/lib/api';
import { ago, copy, title as titleCase } from '@/lib/format';
import { useRoots } from '@/lib/options';
import { Button, Card, ErrorNote, Field, Input, Notice, Options, Select, Spinner, StateBadge, useToast, ActionButton } from '@/components/ui';

const STEPS = [
  { id: 'organization', label: 'Your workspace' },
  { id: 'brands', label: 'Brands & channels' },
  { id: 'devices', label: 'Connect a PC' },
  { id: 'roots', label: 'Choose folders' },
  { id: 'first_scan', label: 'First scan' },
  { id: 'integrations', label: 'Integrations' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'INR', 'AUD', 'AED', 'SGD', 'JPY'];
const PLATFORMS = ['youtube', 'instagram', 'facebook', 'tiktok', 'snapchat', 'x', 'threads', 'linkedin', 'website', 'other'];

export default function SetupPage() {
  const router = useRouter();
  const status = useApi<{ initialized: boolean }>('/setup/status', { revalidateOnFocus: false });
  const me = useApi<any>('/me', { shouldRetryOnError: false, revalidateOnFocus: false });
  const [step, setStep] = useState<StepId>('organization');

  useEffect(() => {
    if (status.data?.initialized && me.error?.status === 401) router.replace('/login');
  }, [status.data, me.error, router]);

  useEffect(() => {
    // resume where the server says we stopped
    const s = me.data?.setup?.step as string | undefined;
    if (s && STEPS.some((x) => x.id === s)) setStep(s as StepId);
    else if (me.data && s === 'welcome') setStep('brands');
    else if (me.data?.setup?.completedAt) router.replace('/');
  }, [me.data, router]);

  if (status.isLoading || (status.data?.initialized && me.isLoading)) return <Spinner label="Loading setup" />;
  if (status.error) return <ErrorNote error={status.error} retry={() => void status.mutate()} />;

  const signedIn = Boolean(me.data);
  const idx = STEPS.findIndex((s) => s.id === step);
  const advance = async (to?: StepId, done = false) => {
    const next = to ?? STEPS[Math.min(idx + 1, STEPS.length - 1)]!.id;
    if (done) {
      await put('/setup/step', { step: 'done', complete: true });
      await refresh('/me');
      router.replace('/');
      return;
    }
    await put('/setup/step', { step: next }).catch(() => undefined);
    setStep(next);
  };

  if (!signedIn) {
    return (
      <div className="w-full max-w-lg">
        <Header />
        <OwnerForm onDone={async () => { await refresh('/me'); setStep('brands'); }} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl py-6">
      <Header />
      <ol className="mb-5 flex flex-wrap gap-2" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s.id} className={clsx('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs', i === idx ? 'border-accent bg-accent/10 text-accent' : i < idx ? 'border-ok/40 text-ok' : 'border-border text-muted')}>
            {i < idx ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
            {s.label}
          </li>
        ))}
      </ol>
      {step === 'organization' && <Notice tone="ok" title="Workspace created">Next, describe the brands and channels you create for.</Notice>}
      {step === 'brands' && <BrandsStep onNext={() => advance('devices')} />}
      {step === 'devices' && <DevicesStep onNext={() => advance('roots')} />}
      {step === 'roots' && <RootsStep onNext={() => advance('first_scan')} />}
      {step === 'first_scan' && <ScanStep onNext={() => advance('integrations')} />}
      {step === 'integrations' && <IntegrationsStep onDone={() => advance(undefined, true)} />}
      {step === 'organization' && (
        <div className="mt-4">
          <Button variant="primary" onClick={() => advance('brands')}>Continue</Button>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-5 text-center">
      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-accent text-sm font-extrabold text-accentfg">C/OS</div>
      <h1 className="text-2xl font-semibold">Welcome to Creator OS</h1>
      <p className="mt-1 text-sm text-muted">Set up takes a few minutes. Every step can be skipped and finished later from Settings.</p>
    </div>
  );
}

function OwnerForm({ onDone }: { onDone: () => Promise<void> }) {
  const tzs = useMemo(() => {
    try {
      return (Intl as any).supportedValuesOf('timeZone') as string[];
    } catch {
      return ['UTC'];
    }
  }, []);
  const [f, setF] = useState({ name: '', email: '', password: '', orgName: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', currency: 'CAD' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const local = f.email.split('@')[0] ?? '';
  const pwHints = [
    { ok: f.password.length >= 12, text: 'At least 12 characters' },
    { ok: !(local.length >= 4 && f.password.toLowerCase().includes(local.toLowerCase())), text: 'Does not contain your e-mail name' },
  ];
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Create the owner account</h2>
      <p className="mb-4 text-sm text-muted">There is no default password. This is the only account with full control; you can add editors and viewers later.</p>
      <form
        className="space-y-3"
        aria-label="Create owner"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await post('/setup/bootstrap', { ...f, email: f.email.trim(), name: f.name.trim(), orgName: f.orgName.trim() }, { silent401: true });
            await onDone();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name"><Input required autoComplete="name" value={f.name} onChange={set('name')} /></Field>
          <Field label="E-mail"><Input type="email" required autoComplete="username" value={f.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Password">
          <Input type="password" required autoComplete="new-password" value={f.password} onChange={set('password')} />
        </Field>
        <ul className="space-y-0.5 text-xs">
          {pwHints.map((h) => (
            <li key={h.text} className={h.ok ? 'text-ok' : 'text-muted'}>{h.ok ? '✓' : '○'} {h.text}</li>
          ))}
          <li className="text-muted">Tip: a few random words, e.g. “violet harbor lantern quartz”.</li>
        </ul>
        <Field label="Workspace / company name"><Input required value={f.orgName} onChange={set('orgName')} placeholder="e.g. Mehak Studios" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Time zone" hint="Used for scheduling and daily briefings."><Select value={f.timezone} onChange={set('timezone')}>{tzs.map((z) => <option key={z}>{z}</option>)}</Select></Field>
          <Field label="Main currency"><Select value={f.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </div>
        {error != null && <ErrorNote error={error} />}
        <Button type="submit" variant="primary" busy={busy} className="w-full">Create workspace</Button>
      </form>
    </Card>
  );
}

function BrandsStep({ onNext }: { onNext: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ brand: '', channel: '', platform: 'youtube', handle: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const demo = useApi<{ seeded: boolean }>('/demo');
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Brands & channels</h2>
      <p className="mb-4 text-sm text-muted">A brand (e.g. “Mehak”) owns channels (e.g. a YouTube music channel), and channels own social accounts. You can add more later in Channels.</p>
      <form className="space-y-3" aria-label="First brand" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const b = await post('/brands', { name: f.brand.trim() });
          if (f.channel.trim()) {
            const c = await post('/channels', { brandId: b.id, name: f.channel.trim() });
            if (f.handle.trim()) await post('/social-accounts', { channelId: c.id, platform: f.platform, handle: f.handle.trim() });
          }
          toast.ok('Saved');
          await onNext();
        } catch (err) {
          toast.error(err);
        } finally {
          setBusy(false);
        }
      }}>
        <Field label="Brand name"><Input required value={f.brand} onChange={set('brand')} placeholder="e.g. Mehak" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="First channel (optional)"><Input value={f.channel} onChange={set('channel')} placeholder="e.g. Mehak Music" /></Field>
          <Field label="Platform"><Select value={f.platform} onChange={set('platform')}><Options values={PLATFORMS} /></Select></Field>
          <Field label="Handle"><Input value={f.handle} onChange={set('handle')} placeholder="@name" /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" busy={busy}>Save and continue</Button>
          <Button type="button" onClick={() => void onNext()}>Skip for now</Button>
        </div>
      </form>
      {!demo.data?.seeded && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-sm text-muted">Just exploring? Load clearly labelled DEMO records (no fake files, no fake verified statistics). You can remove them in one click in Settings.</p>
          <ActionButton size="sm" onAction={async () => { await post('/demo'); await refresh(); }} success="Demo data loaded">Load demo data</ActionButton>
        </div>
      )}
    </Card>
  );
}

function DevicesStep({ onNext }: { onNext: () => Promise<void> }) {
  const devices = useApi<any[]>('/devices', { refreshInterval: 3000 });
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const toast = useToast();
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const online = (devices.data ?? []).filter((d) => d.state !== 'REVOKED');
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Connect a PC that holds your media</h2>
      <p className="mb-3 text-sm text-muted">
        A small read-only <strong>scanner agent</strong> runs on each Windows PC. It lists and fingerprints your files and serves them to this app on request. Original files are never copied, moved or modified.
      </p>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
        <li>Copy <code className="rounded bg-panel2 px-1">creatoros-agent-windows-amd64.exe</code> to the PC (built by <code className="rounded bg-panel2 px-1">pnpm agent:build</code>).</li>
        <li>Create a one-time pairing code below.</li>
        <li>In an Administrator PowerShell on that PC run the two commands that appear.</li>
      </ol>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ActionButton variant="primary" onAction={async () => setCode(await post('/pairing-codes', { label: 'Setup wizard' }))}>Create pairing code</ActionButton>
        {code && <span className="rounded-lg border border-border bg-panel2 px-3 py-2 font-mono text-lg tracking-widest" aria-label="Pairing code">{code.code}</span>}
      </div>
      {code && (
        <div className="mb-4 space-y-2">
          <pre className="overflow-x-auto rounded-lg bg-panel2 p-3 text-xs">{`.\\creatoros-agent-windows-amd64.exe pair --server ${origin} --code ${code.code}\n.\\creatoros-agent-windows-amd64.exe install`}</pre>
          <Button size="sm" onClick={async () => { await copy(`.\\creatoros-agent-windows-amd64.exe pair --server ${origin} --code ${code.code}\n.\\creatoros-agent-windows-amd64.exe install`); toast.ok('Copied'); }}>Copy commands</Button>
          <p className="text-xs text-muted">The code works once and expires in about 30 minutes. It is never shown again.</p>
        </div>
      )}
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-medium">Connected devices</h3>
        {online.length === 0 ? <p className="text-sm text-muted">Waiting for a device… (this list refreshes automatically)</p> : (
          <ul className="space-y-1">
            {online.map((d) => <li key={d.id} className="flex items-center gap-2 text-sm"><StateBadge state={d.state} /> {d.displayName ?? d.hostname}</li>)}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void onNext()} disabled={online.length === 0}>Continue</Button>
        <Button onClick={() => void onNext()}>Skip for now</Button>
      </div>
    </Card>
  );
}

function RootsStep({ onNext }: { onNext: () => Promise<void> }) {
  const devices = useApi<any[]>('/devices');
  const roots = useRoots(5000);
  const [f, setF] = useState({ deviceId: '', label: '', displayPath: '', hashMode: 'all' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const list = (devices.data ?? []).filter((d) => d.state !== 'REVOKED');
  useEffect(() => { if (!f.deviceId && list[0]) setF((s) => ({ ...s, deviceId: list[0].id })); }, [list, f.deviceId]);
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Choose folders to index</h2>
      <p className="mb-3 text-sm text-muted">Use full paths as that PC sees them, e.g. <code className="rounded bg-panel2 px-1">D:\Creator\Renders</code> or a share like <code className="rounded bg-panel2 px-1">\\NAS\media</code>. Indexing is read-only.</p>
      {list.length === 0 ? <Notice tone="warn" title="No device connected yet">Go back and pair a PC, or skip and add folders later in Storage & Devices.</Notice> : (
        <form className="space-y-3" aria-label="Add folder" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post('/roots', { deviceId: f.deviceId, label: f.label.trim(), displayPath: f.displayPath.trim(), hashMode: f.hashMode });
            setF((s) => ({ ...s, label: '', displayPath: '' }));
            await roots.mutate();
            toast.ok('Folder added. The agent will pick it up within seconds.');
          } catch (err) { toast.error(err); } finally { setBusy(false); }
        }}>
          <Field label="Device"><Select value={f.deviceId} onChange={set('deviceId')}>{list.map((d) => <option key={d.id} value={d.id}>{d.displayName ?? d.hostname}</option>)}</Select></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input required value={f.label} onChange={set('label')} placeholder="e.g. ComfyUI renders" /></Field>
            <Field label="Folder path"><Input required value={f.displayPath} onChange={set('displayPath')} placeholder="D:\Creator\Renders" /></Field>
          </div>
          <Field label="Fingerprinting" hint="“All” hashes every file once (best duplicate detection; slower first scan). “Candidates” hashes only files that look like duplicates.">
            <Select value={f.hashMode} onChange={set('hashMode')}><option value="all">All files</option><option value="candidates">Only likely duplicates</option><option value="off">Off</option></Select>
          </Field>
          <Button type="submit" variant="primary" busy={busy}>Add folder</Button>
        </form>
      )}
      {(roots.data ?? []).length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {roots.data!.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><StateBadge state={r.state} /> <span className="font-medium">{r.label}</span> <span className="text-muted">{r.displayPath}</span></li>)}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void onNext()}>Continue</Button>
      </div>
    </Card>
  );
}

function ScanStep({ onNext }: { onNext: () => Promise<void> }) {
  const roots = useRoots(3000);
  const counts = useApi<any>('/library/counts', { refreshInterval: 3000 });
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">First scan</h2>
      <p className="mb-3 text-sm text-muted">Scanning runs on your PC in the background and can take a while for large libraries. You don't need to wait here.</p>
      <div className="mb-3 text-sm">Files indexed so far: <strong className="tabular-nums">{counts.data?.total ?? 0}</strong></div>
      <ul className="mb-4 space-y-2">
        {(roots.data ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm">
            <StateBadge state={r.state} /> <span className="font-medium">{r.label}</span>
            <span className="text-muted">{r.lastSuccessfulScanAt ? `Last complete scan ${ago(r.lastSuccessfulScanAt)} · ${r.fileCount} files` : r.lastScanAt ? 'Scanning…' : 'Waiting for first scan'}</span>
            <ActionButton size="sm" className="ml-auto" onAction={async () => { await post(`/roots/${r.id}/scan`, {}); await roots.mutate(); }} success="Scan requested">Scan now</ActionButton>
          </li>
        ))}
        {(roots.data ?? []).length === 0 && <li className="text-sm text-muted">No folders yet — you can add them later.</li>}
      </ul>
      <Button variant="primary" onClick={() => void onNext()}>Continue</Button>
    </Card>
  );
}

function IntegrationsStep({ onDone }: { onDone: () => Promise<void> }) {
  const integ = useApi<any[]>('/integrations');
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Integrations (optional)</h2>
      <p className="mb-3 text-sm text-muted">Creator OS works without any of these. Connect them whenever you have credentials; each one shows exactly what is missing and never pretends to be connected.</p>
      <ul className="mb-4 space-y-1.5 text-sm">
        {(integ.data ?? []).map((p) => (
          <li key={p.provider} className="flex flex-wrap items-center gap-2"><span className="w-28 font-medium">{titleCase(p.provider)}</span><StateBadge state={p.state} /><span className="text-xs text-muted">{p.capabilities?.blockers?.[0] ?? ''}</span></li>
        ))}
      </ul>
      <Button variant="primary" busy={busy} onClick={async () => { setBusy(true); try { await onDone(); } finally { setBusy(false); } }}>Finish setup</Button>
    </Card>
  );
}

