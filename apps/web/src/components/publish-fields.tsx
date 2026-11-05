'use client';

import { useEffect, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ApiError, api, post } from '@/lib/api';

const PRIVACY = [
  { id: 'PUBLIC', label: 'Public' },
  { id: 'UNLISTED', label: 'Unlisted' },
  { id: 'PRIVATE', label: 'Private' },
];

export function shortNote(item: { width?: number | null; height?: number | null; durationMs?: number | null }) {
  const w = Number(item.width);
  const h = Number(item.height);
  const ms = Number(item.durationMs);
  const size = w > 0 && h > 0 ? `${w}×${h}` : '';
  const length = ms > 0 ? `${Math.round(ms / 1000)}s` : '';
  const measured = [size, length].filter(Boolean).join(', ');
  const fits = w > 0 && h > 0 && h >= w && ms > 0 && ms <= 180_000;
  if (fits) return 'This file is vertical and 3 minutes or shorter, so YouTube can list it as a Short.';
  if (measured)
    return `This file is ${measured}. YouTube only lists a Short when the picture is vertical or square and the video is 3 minutes or shorter. A wide file still posts as a normal video.`;
  return 'YouTube only lists a Short when the picture is vertical or square and the video is 3 minutes or shorter. A wide file still posts as a normal video.';
}

export function parseTags(tags: string): string[] {
  return String(tags)
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, ''))
    .filter(Boolean);
}

/** The same boxes the live Publish dialog asks for, by platform. */
export function PublishFields({
  platform,
  item,
  title,
  setTitle,
  caption,
  setCaption,
  tags,
  setTags,
  privacy,
  setPrivacy,
  contentForm,
  setContentForm,
  accountId,
  playlistIds,
  setPlaylistIds,
  aiUse,
  setAiUse,
}: {
  platform: string;
  item?: { width?: number | null; height?: number | null; durationMs?: number | null } | null;
  title: string;
  setTitle: (v: string) => void;
  caption: string;
  setCaption: (v: string) => void;
  tags: string;
  setTags: (v: string) => void;
  privacy: string;
  setPrivacy: (v: string) => void;
  contentForm: string;
  setContentForm: (v: string) => void;
  accountId?: string;
  playlistIds?: string[];
  setPlaylistIds?: (v: string[]) => void;
  aiUse?: string;
  setAiUse?: (v: string) => void;
}) {
  if (platform === 'youtube') {
    return (
      <>
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <Field label="Tags">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="song, mehak" />
        </Field>
        <p className="text-xs text-muted">Tags are sent as YouTube tags. The description is only the text above.</p>
        <Field label="Type">
          <Select required value={contentForm} onChange={(e) => setContentForm(e.target.value)}>
            <option value="">Choose…</option>
            <option value="VIDEO">Video</option>
            <option value="SHORT">Short</option>
          </Select>
        </Field>
        <p className="text-xs text-muted">
          {contentForm === 'SHORT'
            ? `${shortNote(item ?? {})} Choosing Short adds #Shorts to the title. The file is not cropped.`
            : contentForm === 'VIDEO'
              ? 'Posts as a normal video.'
              : 'Choose Video or Short. YouTube lists a Short when the file is vertical or square and at most 3 minutes.'}
        </p>
        <Field label="Privacy">
          <Select required value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
            <option value="">Choose…</option>
            {PRIVACY.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {accountId && setPlaylistIds ? (
          <YoutubePlaylists accountId={accountId} playlistIds={playlistIds ?? []} setPlaylistIds={setPlaylistIds} />
        ) : null}
        <Field label="AI use">
          <Select required value={aiUse ?? ''} onChange={(e) => setAiUse?.(e.target.value)}>
            <option value="">Choose…</option>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </Select>
        </Field>
        <p className="text-xs text-muted">
          YouTube asks if the video uses altered or synthetic media. Yes and No are sent with the upload. Nothing is sent until you schedule or publish.
        </p>
      </>
    );
  }
  if (platform === 'instagram') {
    return (
      <>
        <Field label="Caption">
          <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <Field label="Hashtags">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="music, newrelease" />
        </Field>
        <p className="text-xs text-muted">Posted as a Reel.</p>
      </>
    );
  }
  if (platform === 'facebook') {
    return (
      <>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
      </>
    );
  }
  return (
    <Field label="Caption">
      <Textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} />
    </Field>
  );
}

function YoutubePlaylists({
  accountId,
  playlistIds,
  setPlaylistIds,
}: {
  accountId: string;
  playlistIds: string[];
  setPlaylistIds: (v: string[]) => void;
}) {
  const [rows, setRows] = useState<{ id: string; title: string }[]>([]);
  const [canCreate, setCanCreate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState('UNLISTED');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let gone = false;
    setLoading(true);
    setError(null);
    void api<{ playlists: { id: string; title: string }[]; canCreate: boolean }>(
      `/social-accounts/${accountId}/youtube/playlists`,
    )
      .then((page) => {
        if (gone || !page) return;
        setRows(page.playlists ?? []);
        setCanCreate(page.canCreate !== false);
      })
      .catch((e) => {
        if (!gone) setError(e instanceof ApiError ? e.message : 'Playlists could not be loaded from YouTube.');
      })
      .finally(() => {
        if (!gone) setLoading(false);
      });
    return () => {
      gone = true;
    };
  }, [accountId]);

  const shown = [
    ...rows,
    ...playlistIds.filter((id) => !rows.some((row) => row.id === id)).map((id) => ({ id, title: id })),
  ];

  async function create() {
    const title = name.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      const created = await post<{ id: string; title: string }>(`/social-accounts/${accountId}/youtube/playlists`, {
        title,
        privacy,
      });
      if (created?.id) {
        setRows((cur) => (cur.some((row) => row.id === created.id) ? cur : [...cur, { id: created.id, title: created.title || title }]));
        if (!playlistIds.includes(created.id)) setPlaylistIds([...playlistIds, created.id]);
        setName('');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'YouTube did not create the playlist.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <Field label="Playlists">
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-panel2 p-2">
          {loading ? <p className="text-xs text-muted">Loading playlists from YouTube…</p> : null}
          {!loading && shown.length === 0 ? <p className="text-xs text-muted">This channel has no playlists yet.</p> : null}
          {shown.map((row) => (
            <label key={row.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={playlistIds.includes(row.id)}
                onChange={() =>
                  setPlaylistIds(
                    playlistIds.includes(row.id) ? playlistIds.filter((id) => id !== row.id) : [...playlistIds, row.id],
                  )
                }
              />
              <span className="truncate">{row.title}</span>
            </label>
          ))}
        </div>
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="New playlist">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" />
        </Field>
        <Field label="Playlist privacy">
          <Select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
            {PRIVACY.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button size="sm" busy={creating} disabled={!name.trim() || !canCreate} onClick={() => void create()}>
          Create
        </Button>
      </div>
      {!canCreate ? (
        <p className="text-xs text-muted">Creating a playlist needs the YouTube manage permission. Integrations → Enable comments, then reload.</p>
      ) : (
        <p className="text-xs text-muted">Create adds the playlist on YouTube now. The video is added to the checked playlists when you schedule or publish.</p>
      )}
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}
