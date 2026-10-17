'use client';

import { useRouter } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMe } from '@/components/shell';
import { ActionButton, Async, Badge, Button, Card, CardTitle, EmptyState, Field, FormDialog, Input, KV, Notice, Options, PageHeader, Select, Spinner, StateBadge, Table, Tabs, Td, useToast } from '@/components/ui';
import { del, patch, post, put, refresh, useApi } from '@/lib/api';
import { ago, bytes, copy, title as titleCase, when } from '@/lib/format';

type Tab = 'workspace' | 'team' | 'reminders' | 'security' | 'backups' | 'demo' | 'system';
const TABS: { id: Tab; label: string }[] = [
  { id: 'workspace', label: 'Workspace' }, { id: 'team', label: 'Team' }, { id: 'reminders', label: 'Reminders' }, { id: 'security', label: 'Security' },
  { id: 'backups', label: 'Backups' }, { id: 'demo', label: 'Demo data' }, { id: 'system', label: 'System' },
];

export default function SettingsPage() {
  return <Suspense fallback={<Spinner />}><Settings /></Suspense>;
}

function Settings() {
  const router = useRouter();
  const sp = useSearchParams();
  const [tab, setTabState] = useState<Tab>(TABS.find((t) => t.id === sp.get('tab'))?.id ?? 'workspace');
  const setTab = (t: Tab) => { setTabState(t); router.replace(`/settings?tab=${t}`); };
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'workspace' && <Workspace />}
      {tab === 'team' && <Team />}
      {tab === 'reminders' && <Reminders />}
      {tab === 'security' && <Security />}
      {tab === 'backups' && <Backups />}
      {tab === 'demo' && <Demo />}
      {tab === 'system' && <System />}
    </>
  );
}

function Workspace() {
  const org = useApi<any>('/organization');
  const me = useMe();
  const [f, setF] = useState<any>(null);
  const [fx, setFx] = useState({ base: 'USD', quote: 'CAD', rate: '', rateDate: new Date().toISOString().slice(0, 10) });
  const toast = useToast();
  const tzs = useMemo(() => { try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return ['UTC']; } }, []);
  const owner = me.data?.user.role === 'OWNER';
  return (
    <div className="space-y-4">
      <Async res={org}>
        {(o) => {
          const v = f ?? { name: o.name, timezone: o.timezone, baseCurrency: o.baseCurrency };
          return (
            <Card>
              <CardTitle>Workspace</CardTitle>
              <form className="grid gap-3 sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); try { await patch('/organization', v); await refresh('/organization', '/me'); setF(null); toast.ok('Saved'); } catch (err) { toast.error(err); } }}>
                <Field label="Name"><Input required value={v.name} disabled={!owner} onChange={(e) => setF({ ...v, name: e.target.value })} /></Field>
                <Field label="Time zone"><Select value={v.timezone} disabled={!owner} onChange={(e) => setF({ ...v, timezone: e.target.value })}>{tzs.map((z) => <option key={z}>{z}</option>)}</Select></Field>
                <Field label="Main currency"><Input maxLength={3} value={v.baseCurrency} disabled={!owner} onChange={(e) => setF({ ...v, baseCurrency: e.target.value.toUpperCase() })} /></Field>
                {owner && <div className="sm:col-span-3"><Button type="submit" variant="primary" disabled={!f}>Save changes</Button></div>}
              </form>
            </Card>
          );
        }}
      </Async>
      {owner && (
        <Card>
          <CardTitle>Exchange rates</CardTitle>
          <p className="mb-3 text-sm text-muted">Used only to total money in your main currency. Enter a rate you trust; none are fetched or guessed.</p>
          <form className="grid gap-3 sm:grid-cols-5" onSubmit={async (e) => { e.preventDefault(); try { await put('/fx-rates', { base: fx.base.toUpperCase(), quote: fx.quote.toUpperCase(), rate: Number(fx.rate), rateDate: fx.rateDate, source: 'manual' }); await refresh('/finance'); toast.ok('Rate saved'); setFx({ ...fx, rate: '' }); } catch (err) { toast.error(err); } }}>
            <Field label="From"><Input maxLength={3} required value={fx.base} onChange={(e) => setFx({ ...fx, base: e.target.value })} /></Field>
            <Field label="To"><Input maxLength={3} required value={fx.quote} onChange={(e) => setFx({ ...fx, quote: e.target.value })} /></Field>
            <Field label="Rate"><Input required type="number" step="any" min="0" value={fx.rate} onChange={(e) => setFx({ ...fx, rate: e.target.value })} /></Field>
            <Field label="As of"><Input required type="date" value={fx.rateDate} onChange={(e) => setFx({ ...fx, rateDate: e.target.value })} /></Field>
            <div className="flex items-end"><Button type="submit">Save rate</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}

function Team() {
  const members = useApi<any[]>('/members');
  const me = useMe();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'EDITOR', password: '' });
  const owner = me.data?.user.role === 'OWNER';
  return (
    <>
      <div className="mb-3 flex"><p className="flex-1 text-sm text-muted">Owners have full control. Editors work on content, money and files. Viewers can only look.</p>{owner && <Button variant="primary" onClick={() => setAdding(true)}>Add person</Button>}</div>
      <Async res={members}>
        {(rows) => (
          <Table head={['Name', 'E-mail', 'Role', 'Status', 'Two-factor', '']}>
            {rows.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium">{m.name}</Td><Td>{m.email}</Td>
                <Td>{owner && m.id !== me.data?.user.id ? <Select aria-label={`Role of ${m.name}`} value={m.role} onChange={async (e) => { await patch(`/members/${m.id}`, { role: e.target.value }); await refresh('/members'); }}><Options values={['OWNER', 'EDITOR', 'VIEWER']} /></Select> : titleCase(m.role)}</Td>
                <Td><StateBadge state={m.status} /></Td><Td>{m.totp ? 'On' : 'Off'}</Td>
                <Td>{owner && m.id !== me.data?.user.id && <ActionButton size="sm" confirm={m.status === 'ACTIVE' ? `Disable ${m.name}'s access?` : undefined} onAction={async () => { await patch(`/members/${m.id}`, { status: m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }); await refresh('/members'); }}>{m.status === 'ACTIVE' ? 'Disable' : 'Enable'}</ActionButton>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Async>
      <FormDialog open={adding} onClose={() => setAdding(false)} title="Add person" submitLabel="Add" onSubmit={async () => { await post('/members', f); setF({ name: '', email: '', role: 'EDITOR', password: '' }); await refresh('/members'); }}>
        <Field label="Name"><Input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="E-mail"><Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><Options values={['EDITOR', 'VIEWER', 'OWNER']} /></Select></Field>
        <Field label="Temporary password" hint="At least 12 characters. Share it privately and ask them to change it."><Input required type="password" autoComplete="new-password" minLength={12} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      </FormDialog>
    </>
  );
}

function Reminders() {
  const rules = useApi<any[]>('/follow-up-rules');
  const prefs = useApi<any>('/notification-preferences');
  const [p, setP] = useState<any>(null);
  const toast = useToast();
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Follow-up reminders</CardTitle>
        <p className="mb-3 text-sm text-muted">When something has waited this long, it shows up in your Today list. Reminders only nudge you; nothing is sent to anyone else.</p>
        <Async res={rules}>
          {(rows) => (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <label className="flex min-w-48 flex-1 items-center gap-2"><input type="checkbox" checked={r.enabled} onChange={async (e) => { await patch(`/follow-up-rules/${r.key}`, { enabled: e.target.checked }); await refresh('/follow-up-rules'); }} /> <span className="font-medium">{r.label}</span></label>
                  {r.durationHours != null && (
                    <label className="flex items-center gap-2 text-muted">after <Input aria-label={`Hours for ${r.label}`} className="!w-20" type="number" min={1} defaultValue={r.durationHours} onBlur={async (e) => { const n = Number(e.target.value); if (n && n !== r.durationHours) { await patch(`/follow-up-rules/${r.key}`, { durationHours: n }); await refresh('/follow-up-rules'); } }} /> hours</label>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
      <Async res={prefs}>
        {(n) => {
          const v = p ?? n;
          return (
            <Card>
              <CardTitle>Notifications</CardTitle>
              <form className="grid gap-3 sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); try { await patch('/notification-preferences', { quietStart: v.quietStart, quietEnd: v.quietEnd, digestHour: Number(v.digestHour), inApp: v.inApp }); await refresh('/notification-preferences'); setP(null); toast.ok('Saved'); } catch (err) { toast.error(err); } }}>
                <Field label="Quiet hours start"><Input type="time" value={v.quietStart ?? ''} onChange={(e) => setP({ ...v, quietStart: e.target.value })} /></Field>
                <Field label="Quiet hours end"><Input type="time" value={v.quietEnd ?? ''} onChange={(e) => setP({ ...v, quietEnd: e.target.value })} /></Field>
                <Field label="Daily summary hour (0–23)"><Input type="number" min={0} max={23} value={v.digestHour ?? 8} onChange={(e) => setP({ ...v, digestHour: e.target.value })} /></Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={v.inApp} onChange={(e) => setP({ ...v, inApp: e.target.checked })} /> Show notifications in the app</label>
                <div className="sm:col-span-3"><Button type="submit" variant="primary" disabled={!p}>Save</Button></div>
              </form>
            </Card>
          );
        }}
      </Async>
    </div>
  );
}

function Security() {
  const me = useMe();
  const sessions = useApi<any[]>('/auth/sessions');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [totp, setTotp] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [offPw, setOffPw] = useState('');
  const toast = useToast();
  const members = useApi<any[]>('/members');
  const totpOn = Boolean(members.data?.find((m) => m.id === me.data?.user.id)?.totp);
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Change password</CardTitle>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); try { await post('/auth/password', pw); setPw({ current: '', next: '' }); toast.ok('Password changed. Other sessions were signed out.'); } catch (err) { toast.error(err); } }}>
          <Field label="Current password"><Input type="password" required autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password" hint="12+ characters. A few random words work well."><Input type="password" required minLength={12} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Button type="submit" variant="primary">Change password</Button></div>
        </form>
      </Card>
      <Card>
        <CardTitle>Two-factor sign-in {totpOn ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>}</CardTitle>
        {totpOn ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); try { await post('/auth/totp/disable', { password: offPw }); setOffPw(''); await refresh('/members', '/me'); toast.ok('Two-factor turned off'); } catch (err) { toast.error(err); } }}>
            <Field label="Password to turn off"><Input type="password" required value={offPw} onChange={(e) => setOffPw(e.target.value)} /></Field>
            <Button type="submit" variant="danger">Turn off</Button>
          </form>
        ) : totp ? (
          <div className="space-y-3">
            <p className="text-sm">In your authenticator app (Google Authenticator, 1Password, Authy…) choose “enter a setup key” and type this key:</p>
            <div className="flex flex-wrap items-center gap-2"><code className="break-all rounded bg-panel2 px-2 py-1 text-sm tracking-wider" aria-label="Setup key">{totp.secret}</code><Button size="sm" onClick={async () => { await copy(totp.secret); toast.ok('Copied'); }}>Copy</Button></div>
            <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); try { await post('/auth/totp/enable', { secret: totp.secret, code }); setTotp(null); setCode(''); await refresh('/members', '/me'); toast.ok('Two-factor is on'); } catch (err) { toast.error(err); } }}>
              <Field label="6-digit code"><Input inputMode="numeric" pattern="[0-9 ]{6,7}" required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
              <Button type="submit" variant="primary">Confirm and turn on</Button>
            </form>
          </div>
        ) : (
          <><p className="mb-3 text-sm text-muted">Adds a 6-digit code from your phone to every sign-in. Recommended when you reach Creator OS over Tailscale or a network others share.</p><ActionButton onAction={async () => setTotp(await post('/auth/totp/begin', {}))}>Set up two-factor</ActionButton></>
        )}
      </Card>
      <Card>
        <CardTitle>Signed-in devices</CardTitle>
        <Async res={sessions}>
          {(rows) => (
            <ul className="divide-y divide-border">
              {rows.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <div className="min-w-0 flex-1"><div className="truncate">{s.userAgent ?? 'Unknown browser'} {s.current && <Badge tone="ok">this device</Badge>}</div><div className="text-xs text-muted">{s.ip} · active {ago(s.lastSeenAt)}</div></div>
                  {!s.current && <ActionButton size="sm" onAction={async () => { await del(`/auth/sessions/${s.id}`); await refresh('/auth/sessions'); }}>Sign out</ActionButton>}
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
    </div>
  );
}

function Backups() {
  const list = useApi<any[]>('/backups', { refreshInterval: 10_000 });
  return (
    <div className="space-y-4">
      <Notice tone="info" title="What is backed up">The database dump contains all your records but not your media files (those stay on your PCs) and not your encryption key. Keep <code>ENCRYPTION_KEY</code> from <code>.env</code> in a password manager, or stored integration credentials cannot be restored.</Notice>
      <div className="flex"><ActionButton variant="primary" onAction={async () => { await post('/backups', {}); await refresh('/backups', '/system'); }} success="Backup finished">Back up now</ActionButton></div>
      <Async res={list} empty={<EmptyState title="No backups yet">Press “Back up now”. A scheduled backup also runs every night.</EmptyState>}>
        {(rows) => (
          <Table head={['Started', 'Kind', 'Result', 'Size', 'Checksum', 'Location']}>
            {rows.map((b) => (
              <tr key={b.id}>
                <Td>{when(b.startedAt)}</Td><Td>{titleCase(b.kind)}</Td><Td><StateBadge state={b.state} />{b.error && <div className="text-xs text-bad">{b.error}</div>}</Td>
                <Td>{b.sizeBytes ? bytes(b.sizeBytes) : '—'}</Td><Td><code className="text-xs">{b.checksumSha256?.slice(0, 12) ?? '—'}</code></Td><Td className="max-w-56 truncate text-xs" ><span title={b.target}>{b.target}</span></Td>
              </tr>
            ))}
          </Table>
        )}
      </Async>
    </div>
  );
}

function Demo() {
  const demo = useApi<{ seeded: boolean; createdAt?: string }>('/demo');
  const me = useMe();
  const owner = me.data?.user.role === 'OWNER';
  return (
    <Card>
      <CardTitle>Demo data</CardTitle>
      <p className="mb-3 text-sm text-muted">Sample brands, ideas, a project, a deal and an invoice, all starting with “DEMO” so they can't be mistaken for real records. It contains no files and no fake verified statistics. Removing it never touches your real data.</p>
      <Async res={demo}>
        {(d) => d.seeded ? (
          <div className="space-y-2"><p className="text-sm">Loaded {d.createdAt ? ago(d.createdAt) : ''}.</p><ActionButton variant="danger" disabled={!owner} confirm="Remove all DEMO records?" onAction={async () => { await del('/demo'); await refresh(); }} success="Demo data removed">Remove demo data</ActionButton></div>
        ) : <ActionButton variant="primary" disabled={!owner} onAction={async () => { await post('/demo'); await refresh(); }} success="Demo data loaded">Load demo data</ActionButton>}
      </Async>
    </Card>
  );
}

function System() {
  const health = useApi<any>('/system/health', { refreshInterval: 15_000 });
  const worker = useApi<any>('/system/worker', { refreshInterval: 15_000 });
  const [objectType, setObjectType] = useState('');
  const audit = useApi<any[]>('/audit', { query: { objectType: objectType || undefined, limit: 100 } });
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Health {health.data && <StateBadge state={health.data.status === 'ok' ? 'ONLINE' : 'DEGRADED'} />}</CardTitle>
        <Async res={health}>
          {(h) => (
            <ul className="space-y-1.5 text-sm">
              {Object.entries(h.checks).map(([k, c]: any) => (
                <li key={k} className="flex flex-wrap items-center gap-2"><span aria-hidden>{c.ok ? '✅' : '⚠️'}</span><span className="w-24 font-medium">{titleCase(k)}</span><span className="text-muted">{c.ok ? summarize(c.value) : (c.detail ?? 'needs attention')}</span></li>
              ))}
            </ul>
          )}
        </Async>
        {worker.data && <p className="mt-3 text-xs text-muted">Background worker: {worker.data.alive ? `running (seen ${ago(worker.data.lastSeenAt)})` : 'not running'}</p>}
      </Card>
      <Card>
        <CardTitle action={<Select aria-label="Filter by object" value={objectType} onChange={(e) => setObjectType(e.target.value)}><Options values={['project', 'deal', 'invoice', 'publication', 'device', 'backup', 'organization']} none="All activity" /></Select>}>Activity log</CardTitle>
        <Async res={audit} empty={<p className="text-sm text-muted">No activity.</p>}>
          {(rows) => (
            <ul className="divide-y divide-border text-sm">{rows.map((a) => <li key={a.id} className="flex flex-wrap gap-x-3 py-1.5"><span className="font-mono text-xs">{a.action}</span><span className="text-muted">{a.actorType}</span><span className="ml-auto text-xs text-muted">{when(a.at)}</span></li>)}</ul>
          )}
        </Async>
      </Card>
      <KV items={[['Version', process.env.NEXT_PUBLIC_APP_VERSION ?? '1.0.0']]} />
    </div>
  );
}

function summarize(v: unknown): string {
  if (v == null) return 'ok';
  if (typeof v === 'object') return Object.entries(v as object).map(([k, x]) => `${titleCase(k)}: ${typeof x === 'number' && /bytes/i.test(k) ? bytes(x) : String(x)}`).join(' · ');
  return String(v);
}

