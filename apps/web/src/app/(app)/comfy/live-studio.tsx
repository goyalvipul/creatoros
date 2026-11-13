'use client';

import { useEffect, useMemo, useState } from 'react';
import { YOUTUBE_LIVE_UNSUPPORTED, playlistPosition, verifiedSendingMs, wallClockMs } from '@creatoros/domain';
import { ApiError, del, patch, post, useApi } from '@/lib/api';
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
  progress: { fps?: number; bitrate?: string; speed?: string; outTimeMs?: number; savedPath?: string | null; masterReady?: boolean; agentLog?: string };
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

const DRAFT_KEY = 'cos-live-create';

type CreateDraft = {
  title: string;
  description: string;
  tags: string;
  privacy: 'public' | 'unlisted' | 'private';
  kids: boolean;
  synthetic: 'unset' | 'yes' | 'no';
  ageRestricted: boolean;
  paidPromotion: 'unset' | 'yes' | 'no';
  ads: 'unset' | 'on' | 'off';
  captions: 'off' | 'embedded';
  resolution: '1080p' | '720p';
  loop: boolean;
  mode: 'youtube' | 'manual';
  accountId: string;
  stopMinutes: string;
  playlistName: string;
  rtmpUrl: string;
};

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readCreateDraft(): Partial<CreateDraft> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<CreateDraft>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

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
  const [ageRestricted, setAgeRestricted] = useState(false);
  const [paidPromotion, setPaidPromotion] = useState<'unset' | 'yes' | 'no'>('unset');
  const [ads, setAds] = useState<'unset' | 'on' | 'off'>('unset');
  const [captions, setCaptions] = useState<'off' | 'embedded'>('off');
  const [resolution, setResolution] = useState<'1080p' | '720p'>('1080p');
  const [loop, setLoop] = useState(true);
  const [mode, setMode] = useState<'youtube' | 'manual'>('youtube');
  const [accountId, setAccountId] = useState('');
  const [stopMinutes, setStopMinutes] = useState('');
  const [rtmpUrl, setRtmpUrl] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [busy, setBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => {
    const saved = readCreateDraft();
    if (typeof saved.title === 'string') setTitle(saved.title);
    if (typeof saved.description === 'string') setDescription(saved.description);
    if (typeof saved.tags === 'string') setTags(saved.tags);
    if (typeof saved.kids === 'boolean') setKids(saved.kids);
    if (typeof saved.ageRestricted === 'boolean') setAgeRestricted(saved.ageRestricted);
    if (typeof saved.loop === 'boolean') setLoop(saved.loop);
    if (typeof saved.accountId === 'string') setAccountId(saved.accountId);
    if (typeof saved.stopMinutes === 'string') setStopMinutes(saved.stopMinutes);
    if (typeof saved.playlistName === 'string') setPlaylistName(saved.playlistName);
    if (typeof saved.rtmpUrl === 'string') setRtmpUrl(saved.rtmpUrl);
    setPrivacy(choice(saved.privacy, ['public', 'unlisted', 'private'] as const, 'public'));
    setSynthetic(choice(saved.synthetic, ['unset', 'yes', 'no'] as const, 'unset'));
    setPaidPromotion(choice(saved.paidPromotion, ['unset', 'yes', 'no'] as const, 'unset'));
    setAds(choice(saved.ads, ['unset', 'on', 'off'] as const, 'unset'));
    setCaptions(choice(saved.captions, ['off', 'embedded'] as const, 'off'));
    setResolution(choice(saved.resolution, ['1080p', '720p'] as const, '1080p'));
    setMode(choice(saved.mode, ['youtube', 'manual'] as const, 'youtube'));
    setDraftReady(true);
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    const draft: CreateDraft = {
      title,
      description,
      tags,
      privacy,
      kids,
      synthetic,
      ageRestricted,
      paidPromotion,
      ads,
      captions,
      resolution,
      loop,
      mode,
      accountId,
      stopMinutes,
      playlistName,
      rtmpUrl,
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // The form still works when the browser refuses storage.
    }
  }, [
    draftReady,
    title,
    description,
    tags,
    privacy,
    kids,
    synthetic,
    ageRestricted,
    paidPromotion,
    ads,
    captions,
    resolution,
    loop,
    mode,
    accountId,
    stopMinutes,
    playlistName,
    rtmpUrl,
  ]);
  const state = useApi<{ active: Session | null; notifyMinutes: number; stopMinutes: number }>('/live/state', {
    refreshInterval: 0,
    revalidateOnFocus: false,
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
      totalBytes?: number | null;
      lastSeenAt: string | null;
      roots: string[];
      browsePath: string | null;
      currentSessionId: string | null;
      revokedAt: string | null;
      browseListing?: { name: string; relative: string; kind: 'dir' | 'video' | 'master'; size: number }[];
    }[]
  >(section === 'create' || section === 'machines' ? '/live/machines' : null, {
    refreshInterval: section === 'create' || section === 'machines' ? 10_000 : 0,
    revalidateOnFocus: false,
  });
  const history = useApi<Session[]>(section === 'history' ? '/live/sessions?history=1' : null);
  const playlists = useApi<{ id: string; name: string; items: Item[] }[]>(section === 'create' ? '/live/playlists' : null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const pc = useMemo(() => {
    const rows = (machines.data ?? []).filter((row) => !row.revokedAt && row.os === 'windows');
    const named = rows.filter((row) => /3060|12gb|12 gb/i.test(row.displayName));
    const pool = named.length ? named : rows;
    const withFiles = pool.filter((row) => (row.browseListing ?? []).some((file) => file.kind === 'video' && file.name.toLowerCase() !== 'live.mp4'));
    return withFiles[0] ?? pool[0] ?? null;
  }, [machines.data]);
  const active = state.data?.active ?? null;
  const watching = !!active && ['PREPARING', 'CREATING', 'CONNECTING', 'LIVE', 'INTERRUPTED', 'STOPPING'].includes(active.status);
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void state.mutate(), 5000);
    return () => clearInterval(timer);
  }, [watching]);
  const maxStop = state.data?.stopMinutes ?? 655;
  const place = useMemo(() => {
    if (!active?.progress?.outTimeMs) return null;
    return playlistPosition(
      (active.items ?? []).map((item) => item.durationMs),
      active.progress.outTimeMs,
    );
  }, [active]);

  function move(from: number, to: number) {
    setItems((prev) => {
      const next = [...prev];
      const [row] = next.splice(from, 1);
      if (!row) return prev;
      next.splice(to, 0, row);
      return next;
    });
  }

  function videosOnPc() {
    return (pc?.browseListing ?? []).filter((file) => file.kind === 'video' && file.name.toLowerCase() !== 'live.mp4' && !file.relative.replace(/\\/g, '/').startsWith('stream/'));
  }

  function savedMaster() {
    const file = (pc?.browseListing ?? []).find((entry) => entry.kind === 'master');
    if (!file) return null;
    const root = (pc?.browsePath || 'C:\\MehakLive').replace(/[/\\]+$/, '');
    const sep = root.includes('\\') ? '\\' : '/';
    return `${root}${sep}${file.relative.replace(/[/\\]/g, sep)}`;
  }

  function loadFolder() {
    const videos = videosOnPc();
    if (!videos.length) {
      setError('The RTX 3060 has not reported any videos in C:\\MehakLive. Leave the streaming agent running on that PC, then press Refresh folder.');
      return;
    }
    setItems(videos.map((file) => ({ key: file.name, source: 'agent' as const, name: file.name, agentRelative: file.name, size: file.size })));
    setError(null);
  }

  useEffect(() => {
    if (items.length) return;
    const videos = videosOnPc();
    if (!videos.length) return;
    setItems(videos.map((file) => ({ key: file.name, source: 'agent' as const, name: file.name, agentRelative: file.name, size: file.size })));
  }, [pc, items.length]);

  function streamSettings() {
    return {
      description,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      privacy,
      madeForKids: kids,
      synthetic: synthetic === 'unset' ? null : synthetic === 'yes',
      ageRestricted,
      paidPromotion: paidPromotion === 'unset' ? null : paidPromotion === 'yes',
      ads,
      captions,
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
      latency: 'normal' as const,
    };
  }

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      await post(
        '/live/sessions',
        {
          machineId: pc?.id,
          playlistName: playlistName || null,
          title: title || 'Livestream',
          items: items.map(({ key: _key, ...item }) => item),
          settings: { resolution, loop, mode: 'youtube' },
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      await state.mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'The video was not started.');
    } finally {
      setBusy(false);
    }
  }

  async function goLive() {
    const master = savedMaster();
    const reusable = active?.status === 'READY' ? active.id : null;
    if (!pc || !title || (mode === 'youtube' && !accountId) || (!reusable && !master)) return;
    if (active && active.status !== 'READY' && active.status !== 'ENDED' && active.status !== 'FAILED') return;
    setBusy(true);
    setError(null);
    try {
      let id = reusable;
      if (!id) {
        const made = await post<{ id: string }>(
          '/live/sessions',
          {
            machineId: pc.id,
            title,
            useExistingMaster: true,
            items: [],
            settings: { resolution, loop, mode },
          },
          { idempotencyKey: crypto.randomUUID() },
        );
        id = made.id;
      }
      await post(`/live/sessions/${id}/start`, {
        socialAccountId: mode === 'youtube' ? accountId : null,
        title,
        stopMinutes: stopMinutes ? Number(stopMinutes) : undefined,
        rtmpUrl: mode === 'manual' ? rtmpUrl : null,
        streamKey: mode === 'manual' ? streamKey : null,
        settings: streamSettings(),
      });
      setStreamKey('');
      setRtmpUrl('');
      setSection('active');
      await state.mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'YouTube did not start.');
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
            Live Studio always uses the RTX 3060. Put mp4 files in C:\MehakLive on that PC. Make one video reads them there, writes a matching file in C:\MehakLive\normalized, and saves C:\MehakLive\stream\live.mp4. Nothing is copied over the network. Go live sends that saved file, including one already at C:\MehakLive\live.mp4, without building it again. Closing this page does not stop a stream that has already started.
            The notice is {state.data?.notifyMinutes ?? 600} minutes and the automatic stop is {maxStop} minutes. The stop cannot pass 11 hours.
          </Notice>
          <Notice>
            Computer: {pc ? `${pc.displayName} · ${pc.ready ? 'Ready' : pc.reason} · last seen ${when(pc.lastSeenAt)}` : 'Pair the RTX 3060 under Streaming machines and include 3060 in the name.'} Folder: C:\MehakLive. {videosOnPc().length} video{videosOnPc().length === 1 ? '' : 's'} reported.
          </Notice>
          {!videosOnPc().length ? (
            <Notice tone="warn">
              The mp4 files on the 3060 are not in Kemokem until that PC's streaming agent sends the folder list. It does that about every 25 seconds. Make one video stays off until the names show up here.
            </Notice>
          ) : null}
          {videosOnPc().length && !pc?.ready ? <Notice tone="warn">Make one video stays off because this computer is {pc?.reason}.</Notice> : null}
          <Button type="button" onClick={() => { void machines.mutate(); loadFolder(); }}>Refresh folder</Button>
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
            <Field label="Age restriction" hint="18+. Made for Kids above is separate. YouTube may refuse this on some channels; the stream still starts.">
              <Select value={ageRestricted ? 'yes' : 'no'} onChange={(e) => setAgeRestricted(e.target.value === 'yes')}>
                <option value="no">No</option>
                <option value="yes">Yes, 18+</option>
              </Select>
            </Field>
            <Field label="Paid promotion" hint="Shows YouTube's paid promotion label when you choose Yes.">
              <Select value={paidPromotion} onChange={(e) => setPaidPromotion(e.target.value as typeof paidPromotion)}>
                <option value="unset">Leave unset</option>
                <option value="yes">Yes, disclose</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <Field label="Mid-roll ads" hint="The channel has to be allowed to monetize. If YouTube refuses, the stream still starts.">
              <Select value={ads} onChange={(e) => setAds(e.target.value as typeof ads)}>
                <option value="unset">Leave unset</option>
                <option value="on">Let YouTube insert mid-rolls</option>
                <option value="off">Ads off</option>
              </Select>
            </Field>
            <Field label="Closed captions" hint="Use Embedded only when the video file already contains captions. Automatic captions stay in YouTube Studio.">
              <Select value={captions} onChange={(e) => setCaptions(e.target.value as typeof captions)}>
                <option value="off">Off</option>
                <option value="embedded">Embedded in the video</option>
              </Select>
            </Field>
          </div>
          {mode === 'manual' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="RTMPS address"><Input value={rtmpUrl} onChange={(e) => setRtmpUrl(e.target.value)} autoComplete="off" /></Field>
              <Field label="Stream key"><Input value={streamKey} type="password" onChange={(e) => setStreamKey(e.target.value)} autoComplete="off" /></Field>
            </div>
          ) : null}
          <Notice>
            Make one video stays on the RTX 3060. Each clip is written to C:\MehakLive\normalized. The stream file is saved in C:\MehakLive\stream and is not added to the clip list. YouTube stays closed until you press Go live.
          </Notice>
          {active?.status === 'PREPARING' ? <Notice>Reading C:\MehakLive on the RTX 3060. {active.logExcerpt || 'Waiting for that computer to start.'} This check runs every 5 seconds until the file is saved. YouTube is not open.</Notice> : null}
          {active?.status === 'READY' ? (
            <Notice>
              Saved at {active.progress?.savedPath || savedMaster() || 'C:\\MehakLive\\stream\\live.mp4'}. Press Go live when the title and channel are set.
            </Notice>
          ) : savedMaster() ? (
            <Notice>
              Saved file {savedMaster()} is already on the RTX 3060. Go live uses it as-is. Make one video only when the clips have changed.
            </Notice>
          ) : null}
          <div className="text-sm">
            <div className="font-medium">Requires YouTube Studio</div>
            {YOUTUBE_LIVE_UNSUPPORTED.map((field) => (
              <div key={field.field}><a href={field.href} target="_blank" rel="noreferrer">{field.field}</a></div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" busy={busy} disabled={!pc?.ready || !items.length || (!!active && active.status !== 'ENDED' && active.status !== 'FAILED')} onClick={() => void prepare()}>Make one video</Button>
            <Button type="button" variant="primary" busy={busy} disabled={!pc?.ready || !title || (mode === 'youtube' && !accountId) || (!!active && active.status !== 'READY' && active.status !== 'ENDED' && active.status !== 'FAILED') || (active?.status !== 'READY' && !savedMaster())} onClick={() => void goLive()}>Go live</Button>
            {active && (active.status === 'PREPARING' || active.status === 'READY') ? (
              <Button type="button" variant="danger" onClick={async () => {
                await post(`/live/sessions/${active.id}/stop`, { force: false });
                await state.mutate();
              }}>Discard</Button>
            ) : null}
          </div>
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

      {section === 'machines' ? <Machines rows={machines.data ?? []} onChange={() => machines.mutate()} /> : null}

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
        {session.logExcerpt ? <pre className="whitespace-pre-wrap">{session.logExcerpt}</pre> : null}
        <pre className="whitespace-pre-wrap">{session.progress?.agentLog || 'No lines yet from C:\\ProgramData\\KemokemAgent\\logs\\agent.log'}</pre>
      </details>
    </div>
  );
}

function FolderPath({
  row,
  onChange,
}: {
  row: { id: string; roots: string[]; browsePath?: string | null; browseListing?: { name: string; relative?: string; kind: string }[] };
  onChange: () => void;
}) {
  const [folder, setFolder] = useState(row.roots[0] || row.browsePath || 'C:\\MehakLive');
  const [note, setNote] = useState<string | null>(null);
  const videos = (row.browseListing ?? []).filter((file) => file.kind === 'video' && file.name.toLowerCase() !== 'live.mp4' && !(file.relative ?? '').replace(/\\/g, '/').startsWith('stream/'));
  return (
    <div className="mt-3 space-y-2">
      <Field label="Video folder" hint="The folder on this computer. The agent lists the mp4 files here. They are not copied.">
        <div className="flex flex-wrap gap-2">
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\MehakLive" />
          <Button
            type="button"
            variant="primary"
            disabled={!folder.trim()}
            onClick={async () => {
              setNote(null);
              try {
                await patch(`/live/machines/${row.id}`, { roots: [folder.trim()] });
                setNote('Saved. The computer lists this folder on its next check-in, about every 25 seconds.');
                onChange();
              } catch (e) {
                setNote(e instanceof ApiError ? e.message : 'That folder was not saved.');
              }
            }}
          >
            Save folder
          </Button>
        </div>
      </Field>
      {note ? <div>{note}</div> : null}
      <div>{videos.length ? `${videos.length} videos: ${videos.map((file) => file.name).join(', ')}` : 'No videos reported from this folder yet.'}</div>
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
    lastSeenAt: string | null;
    roots: string[];
    browsePath?: string | null;
    browseListing?: { name: string; kind: string }[];
    currentSessionId: string | null;
    revokedAt: string | null;
  }[];
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [osName, setOs] = useState<'linux' | 'windows' | 'mac'>('windows');
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-4 text-sm">
      <p>On the RTX 3060 card, type the folder that holds the mp4 files and press Save folder. The agent lists that folder on its next check-in. The names appear on this card. Nothing is copied.</p>
      <div className="flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer name" />
        <Select value={osName} onChange={(e) => setOs(e.target.value as typeof osName)}>
          <option value="windows">Windows</option>
          <option value="linux">Ubuntu / Linux</option>
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
          <div>FFmpeg {row.ffmpeg || 'not reported'} · {row.encoders.join(', ') || 'No encoder reported'}</div>
          <div>Free {bytes(row.freeBytes)} · Job {row.currentSessionId || 'none'}</div>
          {row.revokedAt ? null : <FolderPath row={row} onChange={onChange} />}
          {row.revokedAt ? null : (
            <div className="mt-2">
              <Button type="button" variant="danger" onClick={async () => { await post(`/live/machines/${row.id}/revoke`, {}); onChange(); }}>Revoke</Button>
            </div>
          )}
          <div className="mt-2">
            <Button type="button" variant="danger" onClick={async () => {
              if (!window.confirm(`Delete ${row.displayName}? This removes it from Kemokem. Files on that computer stay. A livestream has to be stopped first.`)) return;
              await del(`/live/machines/${row.id}`);
              onChange();
            }}>Delete</Button>
          </div>
        </div>
      ))}
      <p>On that PC, install FFmpeg with NVIDIA support and Node.js 22 or 24. Run `node agent.mjs` from `apps/stream-agent` with `KEMOKEM_URL` and `KEMOKEM_TOKEN`. Log on as the user who can see the GPU. The steps are in `apps/stream-agent/README.md`.</p>
    </div>
  );
}

