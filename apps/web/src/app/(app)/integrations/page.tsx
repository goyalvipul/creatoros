'use client';

import { useState } from 'react';
import { ActionButton, Async, Badge, Button, Card, Field, FormDialog, Input, Notice, PageHeader, StateBadge } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { ago, title as titleCase } from '@/lib/format';

const NAMES: Record<string, string> = { gmail: 'Gmail (read-only)', youtube: 'YouTube', postiz: 'Postiz (scheduling)', todo: 'Todo app', meta: 'Instagram / Facebook', tiktok: 'TikTok', snapchat: 'Snapchat', google: 'Google (umbrella)' };
const OAUTH = ['gmail', 'youtube'];
const KEYED: Record<string, { fields: { name: 'baseUrl' | 'apiKey' | 'accessToken' | 'igUserId'; label: string; type?: string; hint?: string }[] }> = {
  todo: { fields: [{ name: 'baseUrl', label: 'Todo API base URL', type: 'url', hint: 'e.g. http://localhost:5000/api' }, { name: 'apiKey', label: 'API token', type: 'password' }] },
  postiz: { fields: [{ name: 'baseUrl', label: 'Postiz URL', type: 'url' }, { name: 'apiKey', label: 'Public API key', type: 'password' }] },
  meta: { fields: [{ name: 'accessToken', label: 'Long-lived access token', type: 'password' }, { name: 'igUserId', label: 'Instagram user id' }] },
  tiktok: { fields: [{ name: 'accessToken', label: 'Access token', type: 'password' }] },
};

export default function IntegrationsPage() {
  const res = useApi<any[]>('/integrations');
  const [setup, setSetup] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const reload = () => refresh('/integrations');

  const connect = async (provider: string) => {
    const r = await post(`/integrations/${provider}/oauth/start`, {});
    if (r.authorizeUrl) window.location.href = r.authorizeUrl;
    else throw new Error(r.steps?.[0] ?? 'This integration is not available yet.');
  };

  return (
    <>
      <PageHeader title="Integrations" subtitle="Everything is optional. A connection only shows as connected after the provider confirms it; missing pieces are listed so you know exactly what to do." />
      <Notice tone="info" title="Safe by design">Gmail access is read-only. Creator OS never sends e-mail, posts to social platforms or pays anything on its own. Credentials are stored encrypted on your machine.</Notice>
      <div className="mt-4">
        <Async res={res}>
          {(rows) => (
            <ul className="grid gap-3 md:grid-cols-2">
              {rows.filter((p) => p.provider !== 'google').map((p) => {
                const caps = p.capabilities;
                const conn = p.connection;
                const connected = p.state === 'CONNECTED' || p.state === 'DEGRADED';
                return (
                  <li key={p.provider}>
                    <Card className="h-full">
                      <div className="flex items-start gap-2"><h2 className="flex-1 font-semibold">{NAMES[p.provider] ?? titleCase(p.provider)}</h2><StateBadge state={p.state} /></div>
                      {conn?.principalHint && <p className="mt-1 text-sm text-muted">Account: {conn.principalHint}</p>}
                      {conn?.lastError && <p className="mt-1 text-sm text-bad">{conn.lastError}</p>}
                      {caps.blockers?.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">{caps.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul>
                      )}
                      {!connected && caps.setupSteps?.length > 0 && (
                        <details className="mt-2 text-sm"><summary className="cursor-pointer text-accent">How to set this up</summary><ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">{caps.setupSteps.map((s: string) => <li key={s}>{s}</li>)}</ol></details>
                      )}
                      {p.cursors?.length > 0 && <p className="mt-2 text-xs text-muted">{p.cursors.map((c: any) => `${c.scope}: ${c.lastSuccessAt ? ago(c.lastSuccessAt) : 'never synced'}`).join(' · ')}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {OAUTH.includes(p.provider) && !connected && p.state !== 'UNSUPPORTED' && <ActionButton variant="primary" onAction={() => connect(p.provider)}>Connect</ActionButton>}
                        {KEYED[p.provider] && <Button variant={connected ? 'secondary' : 'primary'} onClick={() => { setVals({}); setSetup(p.provider); }}>{conn ? 'Edit settings' : 'Configure'}</Button>}
                        {conn && <ActionButton onAction={async () => { await post(`/integrations/${p.provider}/test`, {}); await reload(); }} success="Connection checked">Test</ActionButton>}
                        {conn && connected && <ActionButton onAction={async () => { await post(`/connections/${conn.id}/sync`, {}); await reload(); }} success="Sync requested">Sync now</ActionButton>}
                        {conn && <ActionButton onAction={async () => { await post(`/connections/${conn.id}/pause`, { paused: conn.state !== 'PAUSED' }); await reload(); }}>{conn.state === 'PAUSED' ? 'Resume' : 'Pause'}</ActionButton>}
                        {conn && <ActionButton variant="danger" confirm="Disconnect and delete the stored credentials?" onAction={async () => { await post(`/connections/${conn.id}/disconnect`, {}); await reload(); }}>Disconnect</ActionButton>}
                      </div>
                      {p.state === 'UNSUPPORTED' && <Badge>no public API</Badge>}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </Async>
      </div>

      {setup && (
        <FormDialog open onClose={() => setSetup(null)} title={`Configure ${NAMES[setup] ?? setup}`} submitLabel="Save" onSubmit={async () => {
          const config: Record<string, unknown> = {};
          if (vals.baseUrl) config.baseUrl = vals.baseUrl.trim();
          if (vals.igUserId) config.igUserId = vals.igUserId.trim();
          await post(`/integrations/${setup}/key`, { apiKey: vals.apiKey || undefined, accessToken: vals.accessToken || undefined, config });
          await post(`/integrations/${setup}/test`, {}).catch(() => undefined);
          await reload();
        }}>
          {KEYED[setup]!.fields.map((fl) => (
            <Field key={fl.name} label={fl.label} hint={fl.hint}><Input type={fl.type ?? 'text'} autoComplete="off" value={vals[fl.name] ?? ''} onChange={(e) => setVals({ ...vals, [fl.name]: e.target.value })} /></Field>
          ))}
          <p className="text-xs text-muted">Leave a secret field empty to keep the stored value. Secrets are encrypted and never shown again.</p>
        </FormDialog>
      )}
    </>
  );
}
