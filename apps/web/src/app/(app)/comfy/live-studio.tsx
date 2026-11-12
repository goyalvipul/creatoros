'use client';

import { useEffect, useMemo, useState } from 'react';
import { YOUTUBE_LIVE_UNSUPPORTED, playlistPosition, verifiedSendingMs, wallClockMs } from '@creatoros/domain';
import { ApiError, patch, post, useApi } from '@/lib/api';
import { Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';

type Section = 'create' | 'active' | 'history' | 'machines';
type Item = {
  key: string;
  source: 'library' | 'upload' | 'agent';
  name: string;
  size?: number | null;
  fileInstanceId?: string;
  uploadId?: string;
  agentRelative?: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio?: boolean | null;
};

type Session = {
  id: string;
  title: string;
  status: string;
  stopReason: string | null;
  error: string | null;
  playlistName: string | null;
  machineName: string | null;
  channel: string | null;
  watchUrl: string | null;
  studioUrl: string;
  replayStatus: string | null;
  replayDetail: string | null;
  items: Item[];
  progress: { fps?: number; bitrate?: string; speed?: string; outTimeMs?: number };
  logExcerpt: string | null;
  policyNotifyMs: number | null;
  policyStopMs: number;
  jobCreatedAt: string;
  encoderStartedAt: string | null;
  youtubeActualStartAt: string | null;
  youtubeActualEndAt: string | null;
  notifyAt: string | null;
  autoStopAt: string | null;
  ingestSafetyAt: string | null;
  lastHeartbeatAt: string | null;
  verifiedLiveMs: number;
  verifiedAt: string | null;
  mode: string;
  manualLimits: string | null;
  settings?: { privacy?: string };
};

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'create', label: 'Create stream' },
  { id: 'active', label: 'Active stream' },
  { id: 'history', label: 'Stream history' },
  { id: 'machines', label: 'Streaming machines' },
];

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

function when(value: string | null) {
  if (!value) return 'Not reported yet';
  return new Date(value).toLocaleString();
}

function bytes(value?: number | null) {
  if (value == null) return 'Size pending';
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function LiveStudio() {
  const [section, setSection] = useState<Section>('create');
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'private'>('public');
  const [kids, setKids] = useState(false);
  const [synthetic, setSynthetic] = useState<'unset' | 'yes' | 'no'>('unset');
  const [resolution, setResolution] = useState<'1080p' | '720p'>('1080p');
  const [loop, setLoop] = useState(true);
  const [mode, setMode] = useState<'youtube' | 'manual'>('youtube');
  const [accountId, setAccountId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [stopMinutes, setStopMinutes] = useState('');
  const [rtmpUrl, setRtmpUrl] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [libraryQ, setLibraryQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const state = useApi<{ active: Session | null; notifyMinutes: number; stopMinutes: number }>('/live/state', {
    refreshInterval: 15_000,
  });
  const accounts = useApi<{ id: string; handle: string; livePermission: boolean; connectionState: string }[]>(
    section === 'create' ? '/live/accounts' : null,
  );
  const machines = useApi<
    {
      id: string;
      displayName: string;
      os: string;
      ready: boolean;
      reason: string;
      ffmpeg: string | null;
      encoders: string[];
      freeBytes: number | null;
      lastSeenAt: string | null;
      roots: string[];
      browsePath: string | null;
      browseListing: { name: string; relative: string; kind: 'dir' | 'video'; size: number }[];
      currentSessionId: string | null;
      revokedAt: string | null;
    }[]
  >(section === 'create' || section === 'machines' ? '/live/machines' : null, { refreshInterval: 15_000 });
  const history = useApi<Session[]>(section === 'history' ? '/live/sessions?history=1' : null);
  const playlists = useApi<{ id: string; name: string; items: Item[] }[]>(section === 'create' ? '/live/playlists' : null);
  const library = useApi<{ items: { id: string; fileName: string; size: number }[] }>(
    section === 'create' ? '/library' : null,
    { query: { kind: 'VIDEO', q: libraryQ, limit: 20 } },
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const active = state.data?.active ?? null;
  const maxStop = state.data?.stopMinutes ?? 655;
  const place = useMemo(() => {
    if (!active?.progress?.outTimeMs) return null;
    return playlistPosition(
      (active.items ?? []).map((item) => item.durationMs),
      active.progress.outTimeMs,
    );
  }, [active]);

  function add(item: Item) {
    setItems((prev) => [...prev, item]);
  }

  function move(from: number, to: number) {
    setItems((prev) => {
      const next = [...prev];
      const [row] = next.splice(from, 1);
      if (!row) return prev;
      next.splice(to, 0, row);
      return next;
    });
  }

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      for (const file of Array.from(list)) body.append('file', file, file.name);
      const res = await fetch('/api/v1/live/uploads', {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'creatoros' },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Those videos were not saved.');
      for (const file of json.data as { id: string; name: string; size: number }[]) {
        add({ key: file.id, source: 'upload', uploadId: file.id, name: file.name, size: file.size });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those videos were not saved.');
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      await post(
        '/live/sessions',
        {
          machineId,
          socialAccountId: mode === 'youtube' ? accountId : null,
          playlistName: playlistName || null,
          title,
          items: items.map(({ key: _key, ...item }) => item),
          stopMinutes: stopMinutes ? Number(stopMinutes) : undefined,
          rtmpUrl: mode === 'manual' ? rtmpUrl : null,
          streamKey: mode === 'manual' ? streamKey : null,
          settings: {
            description,
            tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
            privacy,
            madeForKids: kids,
            synthetic: synthetic === 'unset' ? null : synthetic === 'yes',
            resolution,
            loop,
            mode,
            categoryId: '10',
            language: 'en',
            enableDvr: true,
            recordFromStart: true,
            enableAutoStart: true,
            enableAutoStop: true,
            enableEmbed: true,
            latency: 'normal',
          },
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      setStreamKey('');
      setRtmpUrl('');
      setSection('active');
      await state.mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'The livestream did not start.');
    } finally {
      setBusy(false);
    }
  }

  const wall = active ? wallClockMs(new Date(now), active.youtubeActualStartAt ? new Date(active.youtubeActualStartAt) : null, active.youtubeActualEndAt ? new Date(active.youtubeActualEndAt) : null) : 0;
  const verified = active
    ? verifiedSendingMs(
        active.verifiedLiveMs,
        active.verifiedAt ? new Date(active.verifiedAt) : null,
        new Date(now),
        active.status,
        active.lastHeartbeatAt ? new Date(active.lastHeartbeatAt) : null,
      )
    : 0;
  const remaining = active?.autoStopAt ? Math.max(0, new Date(active.autoStopAt).getTime() - now) : null;

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Live Studio">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            className={section === item.id ? 'studio-tab active' : 'studio-tab'}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}

      {section === 'create' ? (
        <div className="space-y-4">
          <Notice>
            Closing this page does not stop a livestream. The streaming computer keeps going, and the timer is stored on the server.
            The notice is {state.data?.notifyMinutes ?? 600} minutes and the automatic stop is {maxStop} minutes. Both come from the server environment, and the stop cannot pass 11 hours.
          </Notice>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Videos">
              <input className="block w-full text-sm" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.mkv,.webm" multiple onChange={(e) => void upload(e.target.files)} />
            </Field>
            <Field label="Folder" hint="If the browser cannot open a folder, use the video picker.">
              <input className="block w-full text-sm" type="file" multiple {...{ webkitdirectory: '', directory: '' }} onChange={(e) => void upload(e.target.files)} />
            </Field>
          </div>
          <Field label="Library">
            <Input value={libraryQ} onChange={(e) => setLibraryQ(e.target.value)} placeholder="Search videos" />
            <div className="mt-2 max-h-40 space-y-1 overflow-auto">
              {(library.data?.items ?? []).map((file) => (
                <button key={file.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-panel2" onClick={() => add({ key: file.id, source: 'library', fileInstanceId: file.id, name: file.fileName, size: file.size })}>
                  {file.fileName} · {bytes(file.size)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Folder on the streaming computer">
            <div className="space-y-2 text-sm">
              {(machines.data ?? []).filter((m) => !m.revokedAt).map((machine) => (
                <div key={machine.id}>
                  <div className="font-medium">{machine.displayName}</div>
                  {(machine.roots ?? []).map((root) => (
                    <button key={root} type="button" className="mr-2 underline" onClick={() => void post(`/live/machines/${machine.id}/browse`, { path: root }).then(() => machines.mutate())}>{root}</button>
                  ))}
                  {machine.browsePath ? (
                    <div className="mt-1">
                      {machine.browseListing.map((entry) => (
                        <button
                          key={entry.name}
                          type="button"
                          className="mr-2"
                          onClick={() => {
                            const browsePath = machine.browsePath ?? '';
                            const root = (machine.roots ?? []).find((candidate) => browsePath.startsWith(candidate));
                            if (!root || entry.kind !== 'video') {
                              if (entry.kind === 'dir' && browsePath) void post(`/live/machines/${machine.id}/browse`, { path: `${browsePath.replace(/[/\\]+$/, '')}/${entry.name}` }).then(() => machines.mutate());
                              return;
                            }
                            const relative = `${browsePath.slice(root.length).replace(/^[/\\]/, '')}/${entry.name}`.replace(/^\/+/, '');
                            add({ key: `${machine.id}:${relative}`, source: 'agent', name: entry.name, size: entry.size, agentRelative: relative });
                          }}
                        >
                          {entry.kind === 'dir' ? `${entry.name}/` : entry.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Field>
          <div className="space-y-2">
            <div className="text-sm">{items.length} video{items.length === 1 ? '' : 's'}</div>
            {items.map((item, index) => (
              <div
                key={item.key}
                draggable
                onDragStart={() => setDrag(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (drag != null) move(drag, index); setDrag(null); }}
                className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-sm"
              >
                <span className="min-w-0 flex-1">{item.name}</span>
                <span>{bytes(item.size)}</span>
                <span>{item.durationMs ? clock(item.durationMs) : 'Duration after prepare'}</span>
                <Button type="button" size="sm" onClick={() => move(index, Math.max(0, index - 1))}>Up</Button>
                <Button type="button" size="sm" onClick={() => move(index, Math.min(items.length - 1, index + 1))}>Down</Button>
                <Button type="button" size="sm" onClick={() => setItems((prev) => prev.filter((row) => row.key !== item.key))}>Remove</Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Input value={playlistName} onChange={(e) => setPlaylistName(e.target.value)} placeholder="Playlist name" />
            <Button type="button" disabled={!playlistName || !items.length} onClick={() => void post('/live/playlists', { name: playlistName, items }).then(() => playlists.mutate())}>Save playlist</Button>
            <Select value="" onChange={(e) => {
              const found = (playlists.data ?? []).find((row) => row.id === e.target.value);
              if (!found) return;
              setPlaylistName(found.name);
              setItems((found.items ?? []).map((item, index) => ({ ...item, key: item.key || `${found.id}-${index}` })));
            }}>
              <option value="">Load a playlist</option>
              {(playlists.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </Select>
          </div>
          <Field label="Streaming computer">
            <Select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">Choose a ready computer</option>
              {(machines.data ?? []).filter((m) => m.ready).map((m) => (
                <option key={m.id} value={m.id}>{m.displayName} · {m.os} · {m.ffmpeg ? 'FFmpeg' : 'No FFmpeg'}</option>
              ))}
            </Select>
          </Field>
          <Field label="YouTube">
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'youtube' | 'manual')}>
              <option value="youtube">YouTube Live API</option>
              <option value="manual">Manual RTMPS (metadata is not set from here)</option>
            </Select>
          </Field>
          {mode === 'youtube' ? (
            <Field label="Channel">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Choose a channel</option>
                {(accounts.data ?? []).map((account) => (
                  <option key={account.id} value={account.id} disabled={!account.livePermission}>
                    {account.handle}{account.livePermission ? '' : ' · needs livestream permission'}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Notice tone="warn">{'Manual RTMPS does not set the title, privacy, or replay. Kemokem cannot complete that broadcast. The stream key is not shown again.'}</Notice>
          )}
          <Field label="Title"><Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Description"><Textarea value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Tags" hint="Comma separated. Category is Music and the language is English."><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Visibility">
              <Select value={privacy} onChange={(e) => setPrivacy(e.target.value as typeof privacy)}>
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </Select>
            </Field>
            <Field label="Made for kids">
              <Select value={kids ? 'yes' : 'no'} onChange={(e) => setKids(e.target.value === 'yes')}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </Select>
            </Field>
            <Field label="AI or altered content">
              <Select value={synthetic} onChange={(e) => setSynthetic(e.target.value as typeof synthetic)}>
                <option value="unset">Leave unset</option>
                <option value="yes">Yes, disclose</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <Field label="Picture">
              <Select value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}>
                <option value="1080p">1080p30</option>
                <option value="720p">720p30</option>
              </Select>
            </Field>
            <Field label="Automatic stop (minutes)" hint={`Default ${maxStop}. Cannot be later than that.`}>
              <Input value={stopMinutes} inputMode="numeric" placeholder={String(maxStop)} onChange={(e) => setStopMinutes(e.target.value)} />
            </Field>
            <Field label="Loop"><Select value={loop ? 'yes' : 'no'} onChange={(e) => setLoop(e.target.value === 'yes')}><option value="yes">Loop</option><option value="no">Play once</option></Select></Field>
          </div>
          {mode === 'manual' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="RTMPS address"><Input value={rtmpUrl} onChange={(e) => setRtmpUrl(e.target.value)} autoComplete="off" /></Field>
              <Field label="Stream key"><Input value={streamKey} type="password" onChange={(e) => setStreamKey(e.target.value)} autoComplete="off" /></Field>
            </div>
          ) : null}
          <div className="text-sm">
            <div className="font-medium">Requires YouTube Studio</div>
            {YOUTUBE_LIVE_UNSUPPORTED.map((field) => (
              <div key={field.field}><a href={field.href} target="_blank" rel="noreferrer">{field.field}</a></div>
            ))}
          </div>
          <Button type="button" variant="primary" busy={busy} disabled={!title || !machineId || !items.length} onClick={() => void launch()}>Prepare & Go Live</Button>
        </div>
      ) : null}

      {section === 'active' ? (
        <Active session={active} wall={wall} verified={verified} remaining={remaining} place={place} onStop={async (force) => {
          if (!active) return;
          if (force && !window.confirm('Force stop ends the encoder immediately, then Kemokem still tries to complete the YouTube broadcast.')) return;
          await post(`/live/sessions/${active.id}/stop`, { force });
          await state.mutate();
        }} />
      ) : null}

      {section === 'history' ? (
        <div className="space-y-3">
          {(history.data ?? []).map((row) => (
            <div key={row.id} className="rounded border border-border p-3 text-sm">
              <div className="font-medium">{row.title}</div>
              <div>{row.channel || 'No channel'} · {row.machineName} · {row.status} · {row.replayStatus || 'Replay not checked'}</div>
              <div>{when(row.youtubeActualStartAt)} → {when(row.youtubeActualEndAt)}</div>
              <div>Stop: {row.stopReason || 'Still open'}</div>
              {row.error ? <div>{row.error}</div> : null}
              {row.replayDetail ? <div>{row.replayDetail}</div> : null}
              {row.watchUrl ? <a href={row.watchUrl} target="_blank" rel="noreferrer">YouTube</a> : null}
              <Button type="button" size="sm" className="ml-2" onClick={async () => {
                const draft = await post<Session>(`/live/sessions/${row.id}/duplicate`, {});
                setTitle(draft.title);
                setItems((draft.items ?? []).map((item, index) => ({ ...item, key: `${row.id}-${index}` })));
                setSection('create');
              }}>Duplicate</Button>
            </div>
          ))}
          {history.data && !history.data.length ? <p className="text-sm">No finished livestreams yet.</p> : null}
        </div>
      ) : null}

      {section === 'machines' ? <Machines rows={machines.data ?? []} onChange={() => machines.mutate()} /> : null}
    </div>
  );
}

function Active({
  session,
  wall,
  verified,
  remaining,
  place,
  onStop,
}: {
  session: Session | null;
  wall: number;
  verified: number;
  remaining: number | null;
  place: { index: number; next: number } | null;
  onStop: (force: boolean) => Promise<void>;
}) {
  if (!session) return <p className="text-sm">No livestream is running. The timer starts from YouTube&apos;s reported start, not from this page.</p>;
  const current = place ? session.items[place.index] : null;
  const next = place ? session.items[place.next] : null;
  return (
    <div className="space-y-3 text-sm">
      <div className="text-lg font-semibold">{session.status}</div>
      <div>{session.title}</div>
      <div>{session.channel || 'Channel pending'} · {session.machineName}</div>
      <div>On air {session.youtubeActualStartAt ? clock(wall) : 'Waiting for YouTube to report the start'}</div>
      <div>Video sent {clock(verified)} (gaps are not counted)</div>
      <div>Started {when(session.youtubeActualStartAt)}</div>
      <div>Automatic stop {session.autoStopAt ? when(session.autoStopAt) : 'Set when YouTube reports the start'}</div>
      <div>Remaining {remaining == null ? 'Not scheduled yet' : clock(remaining)}</div>
      <div>Playlist {session.playlistName || 'Unsaved'} · {current ? `Now ${current.name}` : 'Current video is known after each file has a duration'}{next ? ` · Next ${next.name}` : ''}</div>
      <div>FFmpeg {session.progress?.fps ?? '—'} fps · {session.progress?.bitrate ?? '—'} · speed {session.progress?.speed ?? '—'}</div>
      <div>Last heartbeat {when(session.lastHeartbeatAt)}</div>
      {session.error ? <Notice tone="warn">{session.error}</Notice> : null}
      {session.manualLimits ? <Notice tone="warn">{session.manualLimits}</Notice> : null}
      {session.replayDetail ? <div>{session.replayDetail}</div> : null}
      <div className="flex flex-wrap gap-2">
        {session.watchUrl ? <a className="underline" href={session.watchUrl} target="_blank" rel="noreferrer">Open on YouTube</a> : null}
        <a className="underline" href={session.studioUrl} target="_blank" rel="noreferrer">YouTube Studio</a>
        <Button type="button" onClick={() => void onStop(false)}>Stop stream</Button>
        <Button type="button" variant="danger" onClick={() => void onStop(true)}>Force stop</Button>
      </div>
      <details>
        <summary>Technical log</summary>
        <pre className="whitespace-pre-wrap">{session.logExcerpt || 'No log yet.'}</pre>
      </details>
    </div>
  );
}

function Machines({
  rows,
  onChange,
}: {
  rows: {
    id: string;
    displayName: string;
    os: string;
    ready: boolean;
    reason: string;
    ffmpeg: string | null;
    encoders: string[];
    freeBytes: number | null;
    totalBytes?: number | null;
    lastSeenAt: string | null;
    roots: string[];
    currentSessionId: string | null;
    revokedAt: string | null;
  }[];
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [osName, setOs] = useState<'linux' | 'windows' | 'mac'>('linux');
  const [token, setToken] = useState<string | null>(null);
  const [roots, setRoots] = useState<Record<string, string>>({});
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer name" />
        <Select value={osName} onChange={(e) => setOs(e.target.value as typeof osName)}>
          <option value="linux">Ubuntu / Linux</option>
          <option value="windows">Windows</option>
          <option value="mac">macOS</option>
        </Select>
        <Button type="button" variant="primary" disabled={!name} onClick={async () => {
          const created = await post<{ token: string }>('/live/machines', { displayName: name, os: osName });
          setToken(created.token);
          setName('');
          onChange();
        }}>Add computer</Button>
      </div>
      {token ? <Notice tone="warn">Copy this token into the agent now. It is not shown again. {token}</Notice> : null}
      {rows.map((row) => (
        <div key={row.id} className="rounded border border-border p-3">
          <div className="font-medium">{row.displayName} · {row.os} · {row.ready ? 'Ready' : row.reason}</div>
          <div>Last seen {when(row.lastSeenAt)}</div>
          <div>FFmpeg {row.ffmpeg || 'not reported'} · {row.encoders.join(', ') || 'No hardware encoder reported'}</div>
          <div>Free {bytes(row.freeBytes)} · Job {row.currentSessionId || 'none'}</div>
          <div>Folders {(row.roots ?? []).join(', ') || 'none yet'}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input value={roots[row.id] ?? ''} onChange={(e) => setRoots((prev) => ({ ...prev, [row.id]: e.target.value }))} placeholder="D:\Media or /media/videos" />
            <Button type="button" onClick={async () => {
              const next = [...(row.roots ?? []), roots[row.id] ?? ''].map((item) => item.trim()).filter(Boolean);
              await patch(`/live/machines/${row.id}`, { roots: next });
              onChange();
            }}>Save folders</Button>
            <Button type="button" variant="danger" onClick={async () => { await post(`/live/machines/${row.id}/revoke`, {}); onChange(); }}>Revoke</Button>
          </div>
        </div>
      ))}
      <p>Install the agent with the steps in apps/stream-agent/README.md. It starts with the operating system and keeps the original deadline after a reboot.</p>
    </div>
  );
}
