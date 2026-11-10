'use client';

import clsx from 'clsx';
import { Link2, MoreHorizontal, Upload } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { FileDownload } from '@/components/file-download';
import { ThumbnailPicker } from '@/components/publish-cover';
import { VideoTrim } from '@/components/video-trim';
import { FileActions, LinkDialog, UploadDialog } from '@/components/publish-board';
import { PublishFields, publishHashtags, publishPrivacy } from '@/components/publish-fields';
import { useMe } from '@/components/shell';
import { VideoThumb } from '@/components/video-thumb';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Notice,
  Select,
  Spinner,
} from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { bytes, title as titleCase, when } from '@/lib/format';
import { AiPublishAssistant } from '@/components/ai-tools';
import { PlatformLogo, platformLabel } from '@/components/platform-logo';
import { threadsTextUnits, tiktokPrivacy } from '@creatoros/domain';

export default function PublishTitlePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Title />
    </Suspense>
  );
}

function Title() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const me = useMe();
  const tz = me.data?.organization?.timezone;
  const page = useApi<any>(id ? `/variants/${id}/publish` : null, { refreshInterval: 8000 });
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [actions, setActions] = useState<any | null>(null);
  const [picked, setPicked] = useState<string | null>(sp.get('file'));
  const [accountId, setAccountId] = useState<string | null>(sp.get('account'));
  const [pane, setPane] = useState<'files' | 'edit' | 'preview'>('edit');
  const [copy, setCopy] = useState({ title: '', caption: '', tags: '' });

  return (
    <>
      <Async res={page}>
        {(data) => {
          const items: any[] = data.items ?? [];
          const current = items.find((item) => item.id === picked) ?? items[0] ?? null;
          const accounts: any[] = data.accounts ?? [];
          const platforms = [...new Set(accounts.map((a) => a.platform as string))];
          const selectedAccount =
            accounts.find((a) => a.id === accountId) ??
            accounts.find((a) => a.platform === platforms[0]) ??
            null;
          const currentDraft = (data.drafts ?? []).find(
            (d: any) => d.itemId === current?.id && d.accountId === selectedAccount?.id,
          );
          return (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                <Link href="/publishing" className="hover:underline">
                  Publishing
                </Link>
                <span> / </span>
                <span>{data.title}</span>
              </p>
              <div className="flex gap-1 xl:hidden" role="tablist">
                {(
                  [
                    ['files', 'Files'],
                    ['edit', 'Edit post'],
                    ['preview', 'Preview'],
                  ] as const
                ).map(([id, name]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={pane === id}
                    className={clsx(
                      'min-h-10 flex-1 rounded-lg text-sm',
                      pane === id ? 'bg-panel font-medium' : 'text-muted',
                    )}
                    onClick={() => setPane(id)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(14rem,22%)_minmax(0,1.7fr)_minmax(16rem,32%)]">
                <aside className={clsx('rounded-2xl border border-border bg-panel p-3', pane === 'files' ? 'block' : 'hidden xl:block')}>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Variant files</h2>
                    <Badge>{items.length}</Badge>
                  </div>
                  <p className="mb-2 text-xs text-muted">Select another file without leaving {data.title}.</p>
                  {items.length === 0 ? (
                    <p className="text-sm text-muted">No videos attached yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {items.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={clsx(
                              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                              current?.id === item.id ? 'bg-panel2' : 'hover:bg-panel2',
                            )}
                            onClick={() => setPicked(item.id)}
                          >
                            <span className="relative inline-block size-10 shrink-0 overflow-hidden rounded bg-panel2">
                              <VideoThumb
                                fileId={item.fileInstanceId}
                                online={item.deviceState === 'ONLINE'}
                                interactive={false}
                                compact
                                className="size-full"
                              />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{item.fileName}</span>
                              <span className="block text-[11px] text-muted">
                                {item.deviceState === 'ONLINE' ? 'Available' : 'Offline'}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 grid gap-2">
                    <Button onClick={() => setLinkOpen(true)}>
                      <Link2 className="size-4" /> Link existing video
                    </Button>
                    <Button onClick={() => setUploadOpen(true)}>
                      <Upload className="size-4" /> Upload to PC
                    </Button>
                  </div>
                </aside>

                <section className={clsx('rounded-2xl border border-border bg-panel p-4', pane === 'edit' ? 'block' : 'hidden xl:block')}>
                  {current && selectedAccount ? (
                    <PublishPanel
                      variantId={id}
                      item={current}
                      accounts={accounts}
                      platforms={platforms}
                      account={selectedAccount}
                      drafts={data.drafts ?? []}
                      tz={tz}
                      onAccount={setAccountId}
                      onCopy={setCopy}
                    />
                  ) : (
                    <Notice tone="warn" title="Nothing to publish yet">
                      Attach a video and add a social account in Channels.
                    </Notice>
                  )}
                </section>

                <aside className={clsx('rounded-2xl border border-border bg-panel p-3', pane === 'preview' ? 'block' : 'hidden xl:block')}>
                  {current ? (
                    <LivePreview
                      variantId={id}
                      item={current}
                      variantTitle={data.title}
                      account={selectedAccount}
                      postTitle={copy.title}
                      caption={copy.caption}
                      tags={copy.tags}
                      draftState={currentDraft?.uploadState}
                      onActions={() => setActions(current)}
                    />
                  ) : (
                    <p className="text-sm text-muted">Link a video to preview it here.</p>
                  )}
                </aside>
              </div>
            </div>
          );
        }}
      </Async>
      {linkOpen && id ? <LinkDialog variantId={id} onClose={() => setLinkOpen(false)} /> : null}
      {uploadOpen && id && <UploadDialog variantId={id} onClose={() => setUploadOpen(false)} />}
      {actions && id && <FileActions variantId={id} item={actions} onClose={() => setActions(null)} />}
    </>
  );
}

function LivePreview({
  variantId,
  item,
  variantTitle,
  account,
  postTitle,
  caption,
  tags,
  draftState,
  onActions,
}: {
  variantId?: string;
  item: any;
  variantTitle: string;
  account?: any;
  postTitle: string;
  caption: string;
  tags: string;
  draftState?: string;
  onActions: () => void;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [expand, setExpand] = useState(false);
  const [trim, setTrim] = useState(false);
  useEffect(() => {
    setRatio(null);
  }, [item.fileInstanceId]);
  const stored =
    Number(item.width) > 0 && Number(item.height) > 0 ? Number(item.width) / Number(item.height) : null;
  const measured = ratio ?? stored;
  const portrait = measured != null && measured < 0.85;
  const square = measured != null && measured >= 0.85 && measured <= 1.15;
  const stageWidth = portrait ? 'min(100%, 17.5rem)' : square ? 'min(100%, 20rem)' : '100%';
  const ratioText = prettyRatio(measured) || ratioLabel(item.width, item.height) || '—';
  const online = item.deviceState === 'ONLINE';
  const heading = postTitle.trim() || variantTitle;
  const platform = account?.platform as string | undefined;
  const frame = (
    <SocialFrame
      platform={platform}
      portrait={portrait}
      title={heading}
      caption={caption}
      tags={tags}
      handle={account?.handle}
      fileId={item.fileInstanceId}
      online={online}
      ratioHint={measured}
      onRatio={setRatio}
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-muted">Visual check</p>
          <h2 className="font-semibold">Live preview</h2>
        </div>
        <Badge tone={online ? 'ok' : 'neutral'}>{online ? `PC online` : 'PC off'}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {platform ? <PlatformLogo platform={platform} className="size-5" /> : null}
        <Badge>{ratioText}</Badge>
        {platform === 'youtube' && portrait ? <Badge>Shorts</Badge> : null}
        {platform === 'instagram' && portrait ? <Badge>Reel</Badge> : null}
      </div>
      <div className="mx-auto" style={{ width: stageWidth, maxWidth: '100%' }}>
        {frame}
      </div>
      {variantId ? (
        <ThumbnailPicker
          variantId={variantId}
          itemId={item.id}
          fileId={item.fileInstanceId}
          durationMs={Number(item.durationMs) || 0}
          online={online}
          hasCover={Boolean(item.hasCover)}
          onSaved={() => void refresh(`/variants/${variantId}/publish`)}
        />
      ) : null}
      <p className="text-xs text-muted">
        {portrait ? 'Vertical' : square ? 'Square' : measured ? 'Widescreen' : 'Shape appears with the first frame'} · {ratioText}
        {platform === 'youtube' && portrait ? ' · Shorts' : ''}
        {platform === 'instagram' && portrait ? ' · Reel' : ''}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Meta label="Duration" value={clock(item.durationMs) || '—'} />
        <Meta label="Ratio" value={ratioText} />
        <Meta label="Size" value={bytes(item.size)} />
        <Meta label="Source" value={item.deviceName || '—'} />
        <Meta label="Resolution" value={item.width && item.height ? `${item.width}×${item.height}` : '—'} />
        <Meta label="Status" value={draftState ? label(draftState) : online ? 'Available' : 'Offline'} />
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setExpand(true)}>Expand</Button>
        {online && (
          <FileDownload icon href={`/api/v1/files/${item.fileInstanceId}/stream?download=1`} name={item.fileName} />
        )}
        {online && item.fileInstanceId ? <Button onClick={() => setTrim(true)}>Edit video</Button> : null}
        <Button onClick={onActions}>
          <MoreHorizontal className="size-4" /> File actions
        </Button>
      </div>
      <p className="text-xs text-muted">{variantTitle}. Nothing here is posted until you confirm a schedule or publish.</p>
      {expand && (
        <Dialog open onClose={() => setExpand(false)} title={heading} wide>
          <div className="mx-auto" style={{ width: portrait ? 'min(100%, 22rem)' : '100%', maxWidth: '100%' }}>
            <SocialFrame
              platform={platform}
              portrait={portrait}
              title={heading}
              caption={caption}
              tags={tags}
              handle={account?.handle}
              fileId={item.fileInstanceId}
              online={online}
              ratioHint={measured}
            />
          </div>
        </Dialog>
      )}
      {trim && item.fileInstanceId ? (
        <VideoTrim fileId={item.fileInstanceId} variantId={variantId} onClose={() => setTrim(false)} />
      ) : null}
    </div>
  );
}

function SocialFrame({
  platform,
  portrait,
  title,
  caption,
  tags,
  handle,
  fileId,
  online,
  ratioHint,
  onRatio,
}: {
  platform?: string;
  portrait: boolean;
  title: string;
  caption: string;
  tags: string;
  handle?: string;
  fileId: string;
  online: boolean;
  ratioHint?: number | null;
  onRatio?: (ratio: number) => void;
}) {
  const blurb = caption.trim();
  const hashes = hashLine(tags);
  const who = (handle ?? '').trim();
  const media = (
    <VideoThumb
      key={fileId}
      fileId={fileId}
      online={online}
      flush
      ratioHint={ratioHint}
      onRatio={onRatio}
      className="w-full"
    />
  );
  const onPicture = portrait && (platform === 'youtube' || platform === 'instagram' || platform === 'tiktok');
  if (onPicture) {
    return (
      <div className="relative overflow-hidden rounded-xl">
        {media}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-3 pt-14 text-left text-white">
          {who ? <p className="truncate text-xs font-semibold">{who}</p> : null}
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">{title}</p>
          {blurb ? <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/85">{blurb}</p> : null}
          {hashes ? <p className="mt-1 truncate text-xs text-white/75">{hashes}</p> : null}
        </div>
      </div>
    );
  }
  if (platform === 'instagram') {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-panel text-left">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="size-7 shrink-0 rounded-full bg-panel2" aria-hidden />
          <span className="truncate text-sm font-semibold">{who || 'Instagram'}</span>
        </div>
        {media}
        <div className="space-y-1 px-3 py-2">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{title}</p>
          {blurb ? (
            <p className="line-clamp-3 text-sm">
              {who ? <span className="font-semibold">{who} </span> : null}
              {blurb}
            </p>
          ) : null}
          {hashes ? <p className="truncate text-xs text-muted">{hashes}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="text-left">
      <div className="overflow-hidden rounded-xl">{media}</div>
      <div className="mt-2 space-y-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{title}</p>
        {who ? <p className="truncate text-xs text-muted">{who}</p> : null}
        {blurb ? <p className="line-clamp-2 text-xs leading-snug text-muted">{blurb}</p> : null}
        {hashes ? <p className="truncate text-xs text-muted">{hashes}</p> : null}
      </div>
    </div>
  );
}

function hashLine(tags: string) {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .join(' ');
}

function PublishPanel({
  variantId,
  item,
  accounts,
  platforms,
  account,
  drafts,
  tz,
  onAccount,
  onCopy,
}: {
  variantId: string;
  item: any;
  accounts: any[];
  platforms: string[];
  account: any;
  drafts: any[];
  tz?: string;
  onAccount: (id: string) => void;
  onCopy: (copy: { title: string; caption: string; tags: string }) => void;
}) {
  const draft = drafts.find((d) => d.itemId === item.id && d.accountId === account.id);
  const samePlatform = accounts.filter((a) => a.platform === account.platform);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [privacy, setPrivacy] = useState('');
  const [contentForm, setContentForm] = useState('');
  const [playlistIds, setPlaylistIds] = useState<string[]>([]);
  const [aiUse, setAiUse] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [seed, setSeed] = useState('');
  const kept = useRef(new Map<string, {
    title: string;
    caption: string;
    tags: string;
    privacy: string;
    contentForm: string;
    playlistIds: string[];
    aiUse: string;
    date: string;
    time: string;
  }>());

  useEffect(() => {
    const key = `${item.id}:${account.id}`;
    if (seed === key) return;
    if (seed) {
      kept.current.set(seed, { title, caption, tags, privacy, contentForm, playlistIds: [...playlistIds], aiUse, date, time });
    }
    const saved = kept.current.get(key);
    if (saved) {
      setTitle(saved.title);
      setCaption(saved.caption);
      setTags(saved.tags);
      setPrivacy(saved.privacy);
      setContentForm(saved.contentForm);
      setPlaylistIds(saved.playlistIds);
      setAiUse(saved.aiUse);
      setDate(saved.date);
      setTime(saved.time);
    } else {
      setTitle(draft?.title ?? item.fileName ?? '');
      setCaption(draft?.caption ?? '');
      setTags((draft?.hashtags ?? []).join(', '));
      setPrivacy(draft?.privacy ?? '');
      setContentForm(draft?.contentForm ?? '');
      setPlaylistIds(draft?.playlistIds ?? []);
      setAiUse(draft?.aiUse ?? '');
      const local = wallClockInput(draft?.scheduledAt, tz);
      if (local) {
        setDate(local.slice(0, 10));
        setTime(local.slice(11, 16));
      } else {
        setDate('');
        setTime('19:00');
      }
    }
    setSeed(key);
  }, [item.id, account.id, draft, seed, tz, item.fileName, title, caption, tags, privacy, contentForm, playlistIds, aiUse, date, time]);

  useEffect(() => {
    onCopy({ title, caption, tags });
  }, [title, caption, tags, onCopy]);

  const zone = (tz ?? 'America/Vancouver').split('/').pop()?.replace(/_/g, ' ');
  const aiReady = aiUse === 'YES' || aiUse === 'NO';
  const detailsReady =
    account.platform === 'youtube'
      ? Boolean(title.trim() && privacy && contentForm && aiReady)
      : account.platform === 'threads'
        ? aiReady && threadsTextUnits(caption) <= 500
        : account.platform === 'tiktok'
          ? Boolean(tiktokPrivacy(privacy)) && aiReady
          : aiReady;
  const body = {
    itemId: item.id,
    socialAccountId: account.id,
    title: title.trim() || null,
    caption: caption.trim() || null,
    hashtags: publishHashtags(account.platform, tags),
    privacy: publishPrivacy(account.platform, privacy),
    contentForm: contentForm || null,
    playlistIds,
    aiUse: aiUse || null,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Publish this video</h2>
        {draft ? <Badge tone={draft.uploadState === 'FAILED' ? 'bad' : 'neutral'}>{label(draft.uploadState)}</Badge> : <Badge>Draft</Badge>}
      </div>
      <p className="text-xs text-muted">Account-specific post details. A scheduled video is sent at the time you set. Nothing is sent until you confirm.</p>
      <AiPublishAssistant
        fileId={item.fileInstanceId}
        platform={account.platform}
        title={title}
        caption={caption}
        tags={tags}
        onApplyTitle={setTitle}
        onApplyCaption={setCaption}
        onApplyTags={setTags}
      />
      <div className="flex gap-1 overflow-x-auto">
        {platforms.map((platform) => {
          const first = accounts.find((a) => a.platform === platform);
          const on = account.platform === platform;
          return (
            <button
              key={platform}
              type="button"
              aria-label={titleCase(platform)}
              title={titleCase(platform)}
              className={clsx(
                'grid size-10 place-items-center rounded-lg',
                on ? 'bg-panel2' : 'text-muted hover:bg-panel2',
              )}
              onClick={() => first && onAccount(first.id)}
            >
              <PlatformLogo platform={platform} className="size-6" />
            </button>
          );
        })}
      </div>
      {samePlatform.length > 1 && (
        <Field label={`${titleCase(account.platform)} account`}>
          <Select value={account.id} onChange={(e) => onAccount(e.target.value)}>
            {samePlatform.map((a) => (
              <option key={a.id} value={a.id}>
                {a.handle}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!account.canPublish && <Notice tone="warn">{account.reason}</Notice>}
      <PublishFields
        platform={account.platform}
        item={item}
        title={title}
        setTitle={setTitle}
        caption={caption}
        setCaption={setCaption}
        tags={tags}
        setTags={setTags}
        privacy={privacy}
        setPrivacy={setPrivacy}
        contentForm={contentForm}
        setContentForm={setContentForm}
        accountId={account.id}
        playlistIds={playlistIds}
        setPlaylistIds={setPlaylistIds}
        aiUse={aiUse}
        setAiUse={setAiUse}
      />
      {samePlatform.length === 1 && (
        <Field label={`${titleCase(account.platform)} account`}>
          <Input readOnly value={`${account.handle}`} />
        </Field>
      )}
      <Field label={`Scheduled time · ${zone}`}>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </Field>
      <ul className="space-y-1 text-xs text-muted">
        <li>{item.fileInstanceId ? '✓' : '○'} Original media linked</li>
        <li>✓ Account selected</li>
        <li>{detailsReady ? '✓' : '○'} Post details available</li>
        <li>{draft?.uploadState === 'SCHEDULED' || draft?.uploadState === 'PUBLISHED' ? '✓' : '○'} Owner confirmation</li>
      </ul>
      {draft?.error && <p className="text-xs text-bad">{draft.error}</p>}
      {draft?.url && (
        <a href={draft.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-accent hover:underline">
          {draft.url}
        </a>
      )}
      {draft?.scheduledAt && <p className="text-xs text-muted">Saved for {when(draft.scheduledAt, tz)}.</p>}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          variant="primary"
          disabled={!account.canPublish || !date || !time || !detailsReady}
          onAction={async () => {
            await post('/publishing/schedule', {
              ...body,
              requestId: crypto.randomUUID(),
              plannedLocal: `${date}T${time}`.slice(0, 16),
              timezone: tz,
            });
            await refresh(`/variants/${variantId}/publish`, '/publishing/matrix');
          }}
          success="Scheduled"
        >
          Schedule
        </ActionButton>
        <ActionButton
          confirm={`Send ${item.fileName} to ${account.handle} now? This posts the file.`}
          disabled={!account.canPublish || locked(draft?.uploadState) || !detailsReady}
          onAction={async () => {
            await post('/publishing/publish', { ...body, requestId: crypto.randomUUID() });
            await refresh(`/variants/${variantId}/publish`, '/publishing/matrix');
          }}
          success="Sent"
        >
          Publish now
        </ActionButton>
      </div>
      <p className="text-xs text-muted">
        {platformLabel(account.platform)} uses this account’s fields. A new social network shows up here when it is added in Channels.
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel2 px-2 py-1.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function clock(ms?: number | null) {
  const n = Number(ms);
  if (!(n > 0)) return '';
  const s = Math.round(n / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function prettyRatio(ratio: number | null) {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return '';
  const known: [number, string][] = [
    [9 / 16, '9:16'],
    [16 / 9, '16:9'],
    [1, '1:1'],
    [4 / 5, '4:5'],
    [3 / 4, '3:4'],
  ];
  const hit = known.find(([value]) => Math.abs(ratio - value) < 0.06);
  if (hit) return hit[1];
  return ratioLabel(Math.round(ratio * 1000), 1000);
}

function ratioLabel(width?: number | null, height?: number | null) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return '';
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(Math.round(w), Math.round(h));
  return `${Math.round(w) / d}:${Math.round(h) / d}`;
}

function locked(state?: string) {
  return state === 'QUEUED' || state === 'UPLOADING' || state === 'PUBLISHED';
}

function label(state: string) {
  if (state === 'QUEUED' || state === 'UPLOADING') return 'Sending';
  if (state === 'PUBLISHED') return 'Published';
  if (state === 'SCHEDULED') return 'Scheduled';
  if (state === 'UNCERTAIN') return 'Check the platform';
  if (state === 'FAILED') return 'Failed';
  return titleCase(state);
}

function wallClockInput(value: unknown, tz?: string) {
  if (!value) return '';
  const d = new Date(String(value).trim().replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
