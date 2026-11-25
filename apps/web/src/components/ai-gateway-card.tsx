'use client';

import { useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { ActionButton, Badge, Button, Card, StateBadge } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { ago } from '@/lib/format';

const path = '/integrations/ai-gateway';
const permissions = [
  ['projects.read', 'Read projects'],
  ['media.read', 'Read videos and saved analysis'],
  ['projects.write', 'Create draft projects'],
] as const;
type Mode = 'local' | 'hosted';
type Settings = {
  enabled: boolean;
  mode: Mode;
  scopes: string[];
  localConfigured: boolean;
  hostedConfigured: boolean;
  localSeen: string | null;
  hostedSeen: string | null;
};

export function AiGatewayCard() {
  const res = useApi<Settings>(path);
  const [expanded, setExpanded] = useState(false);
  const [credential, setCredential] = useState<{ mode: Mode; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const s = res.data;
  const configured = s && (s.mode === 'local' ? s.localConfigured : s.hostedConfigured);
  const seen = s && (s.mode === 'local' ? s.localSeen : s.hostedSeen);
  const label = s?.mode === 'local' ? 'Local MCP' : 'Hosted MCP';
  const state = res.error ? 'ERROR' : !s ? 'PENDING' : !configured ? 'NOT_CONFIGURED' : !s.enabled ? 'PAUSED' : seen ? 'ACTIVE' : 'PENDING';
  const run = async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const save = (p: Partial<Settings>) =>
    run(async () => {
      if (!s) return;
      setCredential(null);
      const next = { ...s, ...p };
      const updated = await post<Settings>(path + '/settings', {
        enabled: next.enabled,
        mode: next.mode,
        scopes: next.scopes,
      });
      await res.mutate(updated, { revalidate: false });
    });

  return (
    <Card className="h-full">
      <div className="flex items-start gap-2">
        <h2 className="flex flex-1 items-center gap-2 font-semibold">
          <Bot className="size-5 shrink-0 text-muted" aria-hidden />
          ChatGPT
        </h2>
        {s?.enabled && configured && !seen && !res.error ? (
          <Badge tone="warn">Awaiting connection</Badge>
        ) : (
          <StateBadge state={state} />
        )}
      </div>
      <p className="mt-1 text-sm text-muted">Private AI Gateway · Local or hosted MCP</p>
      {res.error && (
        <p role="alert" className="mt-1 text-sm text-bad">{res.error.message}</p>
      )}
      {!s && !res.error && <p className="mt-1 text-sm text-muted">Loading connection…</p>}
      {s && (
        <>
          <p className="mt-1 text-sm text-muted">
            Mode: {label} · Gateway {s.enabled ? 'enabled' : 'disabled'}
          </p>
          <p className="mt-1 text-xs text-muted">
            Last authenticated: {seen ? ago(seen) : 'Never'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {permissions.filter(([key]) => s.scopes.includes(key)).map(([key, text]) => (
              <Badge key={key} tone="ok">{text}</Badge>
            ))}
            {!s.scopes.length && <Badge>No permissions enabled</Badge>}
          </div>
          {!configured && <p className="mt-2 text-xs text-muted">Generate a credential and configure your MCP adapter to connect.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} aria-expanded={expanded} onClick={() => {
              setExpanded(!expanded);
              setCredential(null);
            }}>
              {expanded ? 'Close settings' : configured ? 'Edit settings' : 'Configure'}
            </Button>
            <ActionButton disabled={busy} onAction={async () => { await res.mutate(); }}>Refresh status</ActionButton>
            <ActionButton disabled={busy} onAction={() => save({ enabled: !s.enabled })}>
              {s.enabled ? 'Pause' : 'Enable'}
            </ActionButton>
          </div>
          {expanded && (
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <div>
                <h3 className="text-sm font-medium">Connection mode</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['local', 'hosted'] as const).map(m => (
                    <ActionButton key={m} size="sm" disabled={busy || s.mode === m}
                      variant={s.mode === m ? 'primary' : 'secondary'}
                      onAction={() => save({ mode: m })}>
                      {m === 'local' ? 'Local MCP' : 'Hosted MCP'}
                    </ActionButton>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted">Only the selected connector is authorized. Switching does not stop existing jobs.</p>
                <code className="mt-1 block break-all text-xs">/api/v1/ai-gateway/status</code>
              </div>
              <div>
                <h3 className="text-sm font-medium">Permissions</h3>
                <div className="mt-2 space-y-1">
                  {permissions.map(([key, text]) => (
                    <div key={key} className="flex items-center justify-between gap-2 text-sm">
                      <span>{text}</span>
                      <ActionButton size="sm" disabled={busy} onAction={() => save({
                        scopes: s.scopes.includes(key) ? s.scopes.filter(x => x !== key) : [...s.scopes, key],
                      })}>{s.scopes.includes(key) ? 'Enabled' : 'Disabled'}</ActionButton>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium">Connector credentials</h3>
                <div className="mt-2 space-y-2">
                  {(['local', 'hosted'] as const).map(m => {
                    const issued = m === 'local' ? s.localConfigured : s.hostedConfigured;
                    const last = m === 'local' ? s.localSeen : s.hostedSeen;
                    return (
                      <div key={m} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="text-sm font-medium">{m === 'local' ? 'Local' : 'Hosted'}</span>
                          <Badge tone={issued ? 'info' : 'neutral'}>{issued ? 'Credential issued' : 'Not configured'}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted">Last authenticated: {last ? ago(last) : 'Never'}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <ActionButton size="sm" disabled={busy}
                            confirm={issued ? 'Replace the existing credential?' : undefined}
                            onAction={() => run(async () => {
                              setCredential(null);
                              const r = await post<{ token: string; settings: Settings }>(path + '/credential', { mode: m, action: 'rotate' });
                              setCredential({ mode: m, token: r.token });
                              await res.mutate(r.settings, { revalidate: false });
                            })}>{issued ? 'Rotate' : 'Generate credential'}</ActionButton>
                          {issued && (
                            <ActionButton size="sm" disabled={busy} variant="danger" confirm="Revoke this connector?"
                              onAction={() => run(async () => {
                                setCredential(null);
                                const r = await post<{ settings: Settings }>(path + '/credential', { mode: m, action: 'revoke' });
                                await res.mutate(r.settings, { revalidate: false });
                              })}>Revoke</ActionButton>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {credential && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-sm">Copy the {credential.mode} token now. It is shown only once.</p>
                  <code className="mt-2 block break-all text-xs">{credential.token}</code>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <ActionButton size="sm" onAction={async () => {
                      await navigator.clipboard.writeText(credential.token);
                      setCredential(null);
                    }}>Copy and hide</ActionButton>
                    <Button size="sm" onClick={() => setCredential(null)}>Hide</Button>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted">Video generation, publishing metadata writes and scheduling are not available through this gateway yet.</p>
            </div>
          )}
        </>
      )}
      {!s && res.error && <ActionButton className="mt-3" onAction={async () => { await res.mutate(); }}>Retry</ActionButton>}
    </Card>
  );
}
