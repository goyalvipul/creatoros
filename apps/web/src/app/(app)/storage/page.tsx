'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  FormDialog,
  Input,
  KV,
  Notice,
  PageHeader,
  Select,
  StateBadge,
  Table,
  Tabs,
  Td,
  useToast,
} from '@/components/ui';
import { patch, post, refresh, useApi } from '@/lib/api';
import { ago, bytes, copy, title as titleCase, when } from '@/lib/format';
import { useRoots } from '@/lib/options';

export default function StoragePage() {
  const [tab, setTab] = useState<'devices' | 'folders' | 'runs'>('devices');
  return (
    <>
      <PageHeader
        title="Storage & Devices"
        subtitle="The PCs that hold your media and the folders being indexed. Indexing is read-only."
      />
      <Tabs
        tabs={[
          { id: 'devices', label: 'Devices' },
          { id: 'folders', label: 'Folders' },
          { id: 'runs', label: 'Scan history' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'devices' && <Devices />}
      {tab === 'folders' && <Folders />}
      {tab === 'runs' && <Runs />}
    </>
  );
}

function Devices() {
  const devices = useApi<any[]>('/devices', { refreshInterval: 10_000 });
  const codes = useApi<any[]>('/pairing-codes');
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [rename, setRename] = useState<any>(null);
  const [name, setName] = useState('');
  const toast = useToast();
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const cmd = code
    ? `.\\creatoros-agent-windows-amd64.exe pair --server ${origin} --code ${code.code}\n.\\creatoros-agent-windows-amd64.exe install`
    : '';
  return (
    <div className="space-y-4">
      <Async
        res={devices}
        empty={
          <EmptyState title="No devices paired">
            Create a pairing code below and run the agent on the PC that holds your files.
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {rows.map((d) => (
              <li key={d.id}>
                <Card className="h-full">
                  <div className="flex items-start gap-2">
                    <h3 className="flex-1 font-medium">{d.displayName}</h3>
                    <StateBadge state={d.state} />
                  </div>
                  <div className="mt-2">
                    <KV
                      items={[
                        ['Host', `${d.hostname} (${d.os})`],
                        ['Hardware', d.hardwareLabel ?? '—'],
                        ['Agent', d.agentVersion ?? '—'],
                        ['Last seen', d.lastSeenAt ? ago(d.lastSeenAt) : 'never'],
                        ['Folders', String(d.rootCount)],
                        ['Files', `${d.fileCount} (${bytes(d.totalBytes)})`],
                        ...(d.lastError ? [['Last error', d.lastError] as [string, string]] : []),
                      ]}
                    />
                  </div>
                  {d.state === 'OFFLINE' && (
                    <p className="mt-2 text-xs text-muted">
                      Offline devices are “temporarily unavailable”: their files are never reported missing
                      just because the PC is off.
                    </p>
                  )}
                  {d.state !== 'REVOKED' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setName(d.displayName);
                          setRename(d);
                        }}
                      >
                        Rename
                      </Button>
                      <ActionButton
                        size="sm"
                        variant="danger"
                        confirm={`Revoke ${d.displayName}? The agent will stop syncing and must be paired again.`}
                        onAction={async () => {
                          await post(`/devices/${d.id}/revoke`, {});
                          await refresh('/devices', '/roots');
                        }}
                      >
                        Revoke
                      </ActionButton>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Async>

      <Card>
        <CardTitle>Pair another PC</CardTitle>
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            Copy the agent program to the PC (build it with{' '}
            <code className="rounded bg-panel2 px-1">pnpm agent:build</code>).
          </li>
          <li>Create a one-time code here.</li>
          <li>Run the two commands in an Administrator PowerShell on that PC.</li>
        </ol>
        <ActionButton
          variant="primary"
          onAction={async () => {
            setCode(await post('/pairing-codes', { label: 'Storage page' }));
            await codes.mutate();
          }}
        >
          Create pairing code
        </ActionButton>
        {code && (
          <div className="mt-3 space-y-2">
            <div className="font-mono text-2xl tracking-widest" aria-label="Pairing code">
              {code.code}
            </div>
            <pre className="overflow-x-auto rounded-lg bg-panel2 p-3 text-xs">{cmd}</pre>
            <Button
              size="sm"
              onClick={async () => {
                await copy(cmd);
                toast.ok('Copied');
              }}
            >
              Copy commands
            </Button>
            <p className="text-xs text-muted">
              Valid once, expires {when(code.expiresAt)}. It will not be shown again.
            </p>
          </div>
        )}
      </Card>

      <FormDialog
        open={Boolean(rename)}
        onClose={() => setRename(null)}
        title="Rename device"
        onSubmit={async () => {
          await patch(`/devices/${rename.id}`, { displayName: name.trim() });
          await refresh('/devices');
        }}
      >
        <Field label="Name">
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </FormDialog>
    </div>
  );
}

function Folders() {
  const roots = useRoots(10_000);
  const devices = useApi<any[]>('/devices');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({
    deviceId: '',
    label: '',
    displayPath: '',
    smbPath: '',
    mountPath: '',
    extensions: '',
    interval: '360',
    settle: '60',
    hashMode: 'all',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const usable = (devices.data ?? []).filter((d) => d.state !== 'REVOKED');
  return (
    <div className="space-y-4">
      <div className="flex">
        <Button
          variant="primary"
          className="ml-auto"
          onClick={() => {
            setF((s) => ({ ...s, deviceId: s.deviceId || usable[0]?.id || '' }));
            setAdding(true);
          }}
          disabled={usable.length === 0}
        >
          <Plus className="size-4" /> Add folder
        </Button>
      </div>
      {usable.length === 0 && <Notice tone="info">Pair a device first.</Notice>}
      <Async
        res={roots}
        empty={
          <EmptyState title="No folders yet">
            Add a folder such as <code>D:\Creator\Renders</code> on a paired PC.
          </EmptyState>
        }
      >
        {(rows) => (
          <Table head={['Folder', 'Device', 'State', 'Files', 'Size', 'Last full scan', '']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <div className="font-medium">{r.label}</div>
                  <div className="max-w-64 truncate text-xs text-muted" title={r.displayPath}>
                    {r.displayPath}
                  </div>
                </Td>
                <Td>{r.deviceName}</Td>
                <Td>
                  <StateBadge state={r.state} />
                  {r.stillWritingCount > 0 && <Badge tone="warn">{r.stillWritingCount} still writing</Badge>}
                </Td>
                <Td>
                  {r.fileCount}
                  {r.missingCount > 0 && <span className="ml-1 text-warn">({r.missingCount} missing?)</span>}
                </Td>
                <Td>{bytes(r.totalBytes)}</Td>
                <Td>{r.lastSuccessfulScanAt ? ago(r.lastSuccessfulScanAt) : 'not yet'}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <ActionButton
                      size="sm"
                      onAction={async () => {
                        await post(`/roots/${r.id}/scan`, {});
                        await refresh('/roots');
                      }}
                      success="Scan requested. The agent will start on its next check-in."
                    >
                      Scan now
                    </ActionButton>
                    <ActionButton
                      size="sm"
                      title="Full check for removed files"
                      onAction={async () => {
                        await post(`/roots/${r.id}/scan`, { kind: 'reconcile' });
                      }}
                      success="Full check requested"
                    >
                      Full check
                    </ActionButton>
                    {r.state === 'PAUSED' ? (
                      <ActionButton
                        size="sm"
                        onAction={async () => {
                          await post(`/roots/${r.id}/state`, { state: 'ACTIVE' });
                          await refresh('/roots');
                        }}
                      >
                        Resume
                      </ActionButton>
                    ) : (
                      r.state !== 'RETIRED' && (
                        <ActionButton
                          size="sm"
                          onAction={async () => {
                            await post(`/roots/${r.id}/state`, { state: 'PAUSED' });
                            await refresh('/roots');
                          }}
                        >
                          Pause
                        </ActionButton>
                      )
                    )}
                    {r.state !== 'RETIRED' && (
                      <ActionButton
                        size="sm"
                        variant="danger"
                        confirm="Retire this folder? Its files are kept in the catalogue but no longer scanned."
                        onAction={async () => {
                          await post(`/roots/${r.id}/state`, { state: 'RETIRED' });
                          await refresh('/roots');
                        }}
                      >
                        Retire
                      </ActionButton>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Async>
      <FormDialog
        open={adding}
        onClose={() => setAdding(false)}
        wide
        title="Add folder"
        submitLabel="Add"
        onSubmit={async () => {
          await post('/roots', {
            deviceId: f.deviceId,
            label: f.label.trim(),
            displayPath: f.displayPath.trim(),
            hashMode: f.hashMode,
            smbPath: f.smbPath.trim() || undefined,
            mountPath: f.mountPath.trim() || undefined,
            accessMethod: f.smbPath.trim() ? 'SMB' : 'LOCAL',
            extensions: f.extensions
              .split(',')
              .map((s) => s.trim().replace(/^\./, ''))
              .filter(Boolean),
            scanIntervalMinutes: Number(f.interval) || 360,
            settleSeconds: Number(f.settle) || 60,
          });
          setF({ ...f, label: '', displayPath: '', smbPath: '', mountPath: '' });
          await refresh('/roots');
        }}
      >
        <Field label="Device">
          <Select required value={f.deviceId} onChange={set('deviceId')}>
            {usable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input required value={f.label} onChange={set('label')} />
          </Field>
          <Field label="Folder path on that PC">
            <Input
              required
              value={f.displayPath}
              onChange={set('displayPath')}
              placeholder="D:\Creator\Renders"
            />
          </Field>
          <Field label="Network (SMB) path" hint="Optional. Lets you copy a path that works from other PCs.">
            <Input value={f.smbPath} onChange={set('smbPath')} placeholder="\\PC-NAME\Renders" />
          </Field>
          <Field label="Server mount path" hint="Optional. For Linux/Docker hosts.">
            <Input value={f.mountPath} onChange={set('mountPath')} placeholder="/mnt/renders" />
          </Field>
          <Field label="Only these file types" hint="Comma separated, empty = all types.">
            <Input value={f.extensions} onChange={set('extensions')} placeholder="mp4, mov, wav, png" />
          </Field>
          <Field label="Fingerprinting">
            <Select value={f.hashMode} onChange={set('hashMode')}>
              <option value="all">All files</option>
              <option value="candidates">Likely duplicates only</option>
              <option value="off">Off</option>
            </Select>
          </Field>
          <Field label="Scan every (minutes)">
            <Input type="number" min={1} value={f.interval} onChange={set('interval')} />
          </Field>
          <Field
            label="Wait until file is idle (seconds)"
            hint="Prevents indexing files still being rendered."
          >
            <Input type="number" min={0} value={f.settle} onChange={set('settle')} />
          </Field>
        </div>
      </FormDialog>
    </div>
  );
}

function Runs() {
  const runs = useApi<any[]>('/scan-runs', { query: { limit: 50 }, refreshInterval: 15_000 });
  const roots = useRoots();
  const label = (id: string) => roots.data?.find((r) => r.id === id)?.label ?? id.slice(0, 8);
  return (
    <Async
      res={runs}
      empty={
        <EmptyState title="No scans yet">Scan results appear here after the agent's first pass.</EmptyState>
      }
    >
      {(rows) => (
        <Table head={['Started', 'Folder', 'Type', 'Result', 'Files seen', 'Complete?']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{when(r.startedAt)}</Td>
              <Td>{label(r.rootId)}</Td>
              <Td>{titleCase(r.jobType)}</Td>
              <Td>
                <StateBadge state={r.status} />
              </Td>
              <Td>{r.filesSeen ?? r.stats?.filesSeen ?? '—'}</Td>
              <Td>{r.completeSuccess ? 'Yes' : 'No'}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Async>
  );
}
