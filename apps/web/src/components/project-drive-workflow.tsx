'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, CardTitle, Dialog, Input, Notice } from '@/components/ui';
import { VideoThumb } from '@/components/video-thumb';
import { SocialThumbnailStudio } from '@/components/social-thumbnail-studio';
import { post, refresh, useApi } from '@/lib/api';

type SocialRow = {
  itemId: string;
  fileInstanceId: string;
  fileName: string;
  accountId: string;
  platform: string;
  handle: string;
  title: string | null;
  caption: string | null;
  hashtags: string[];
  privacy: string | null;
  contentForm: string | null;
  playlistIds: string[];
  aiUse: string | null;
  uploadState: string;
};
type DriveStatus = {
  configured: boolean;
  folderUrl: string | null;
  job: { id: string; status: string; total: number; completed: number; error?: string | null } | null;
};

function tomorrowByZone(zone: string, afterDays: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (key: string) => Number(parts.find((part) => part.type === key)?.value ?? 0);
  const date = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + afterDays));
  return date.toISOString().slice(0, 10) + 'T10:00';
}

const keyOf = (r: SocialRow) => `${r.itemId}:${r.accountId}`;
const canPrepare = (r: SocialRow) => ['DRAFT', 'FAILED'].includes(r.uploadState) && !!(r.title?.trim() || r.caption?.trim());

export function ProjectDriveWorkflow({ projectId, tz, variantIds = [] }: { projectId: string; tz?: string; variantIds?: string[] }) {
  const zone = tz || 'America/Vancouver';
  const drive = useApi<DriveStatus>(`/projects/${projectId}/drive`);
  const drafts = useApi<SocialRow[]>(`/projects/${projectId}/social-drafts`);
  const assets = useApi<{ itemId: string; fileInstanceId: string; fileName: string }[]>(`/projects/${projectId}/drive/assets`);
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState<'sync' | 'prefill' | 'connect' | 'schedule' | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [prefillErrors, setPrefillErrors] = useState<string[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [coverFor, setCoverFor] = useState<SocialRow | null>(null);
  const [savedCovers, setSavedCovers] = useState<string[]>([]);
  const items = useMemo(() => assets.data ?? [], [assets.data]);
  const scheduledRows = (drafts.data ?? []).filter(canPrepare);
  const readyVideos = items.filter((video) => scheduledRows.some((row) => row.itemId === video.itemId));
  const running = drive.data?.job?.status === 'QUEUED' || drive.data?.job?.status === 'RUNNING';

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(`/projects/${projectId}/drive`), 2500);
    return () => clearInterval(timer);
  }, [projectId, running]);

  async function connect() {
    setBusy('connect'); setError('');
    try {
      const result = await post<{ status: string; authorizeUrl?: string | null }>('/integrations/google/oauth/start', {});
      if (!result.authorizeUrl) throw new Error('Google OAuth is not configured. Check GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI.');
      window.location.assign(result.authorizeUrl);
    } catch (e) { setError(e instanceof Error ? e.message : 'Drive connection could not start.'); setBusy(null); }
  }

  async function sync() {
    setBusy('sync'); setError(''); setNotice('');
    try {
      await post(`/projects/${projectId}/drive/sync`, { itemIds: selection });
      await refresh(`/projects/${projectId}/drive`);
      setNotice('Drive Sync queued. Uploads continue on the server until finished.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Drive Sync did not start.'); }
    finally { setBusy(null); }
  }

  async function uploadJsonFiles(input: FileList | null) {
    if (!input?.length) return;
    setMetadataBusy(true); setError(''); setNotice('');
    try {
      if (input.length > 40) throw new Error('Upload no more than 40 metadata JSON files at once.');
      const files = await Promise.all(Array.from(input).map(async (file) => {
        if (file.size > 100_000) throw new Error(`${file.name} is too large.`);
        return { name: file.name, data: JSON.parse(await file.text()) };
      }));
      const result = await post<{ uploaded: number }>(`/projects/${projectId}/drive/metadata`, { files });
      setNotice(`Saved ${result.uploaded} analyzed JSON files into the Drive project folder. Press Prefill socials to import.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not upload the JSON analysis.'); }
    finally { setMetadataBusy(false); }
  }

  async function prefill() {
    setBusy('prefill'); setError(''); setNotice(''); setPrefillErrors([]);
    try {
      const result = await post<{ imported: number; skipped: number; errors: string[] }>(`/projects/${projectId}/drive/prefill`, {});
      await refresh(`/projects/${projectId}/social-drafts`, '/publishing/matrix',
        ...variantIds.map((id) => `/variants/${id}/publish`));
      setNotice(`Prefilled ${result.imported} social drafts; ${result.skipped} skipped; ${result.errors.length} issues. Open this project's Publishing tab to review imported drafts.`);
      setPrefillErrors(result.errors);
    } catch (e) { setError(e instanceof Error ? e.message : 'Social prefill failed.'); }
    finally { setBusy(null); }
  }

  async function schedule() {
    setBusy('schedule'); setError(''); setNotice('');
    const chosen = scheduledRows.filter((row) => selectedTargets.includes(keyOf(row)));
    if (!chosen.length) { setError('Select at least one prepared social post.'); setBusy(null); return; }
    let count = 0;
    const problems: string[] = [];
    for (const row of chosen) {
      const idx = readyVideos.findIndex((video) => video.itemId === row.itemId);
      const plannedLocal = dates[row.itemId] ?? tomorrowByZone(zone, idx + 1);
      try {
        await post('/publishing/schedule', {
          itemId: row.itemId,
          socialAccountId: row.accountId,
          requestId: crypto.randomUUID(),
          title: row.title,
          caption: row.caption,
          hashtags: row.hashtags,
          privacy: row.privacy || (row.platform === 'youtube' ? 'PRIVATE' : null),
          contentForm: row.contentForm || (row.platform === 'youtube' ? 'SHORT' : null),
          playlistIds: row.playlistIds ?? [],
          aiUse: row.aiUse || 'YES',
          plannedLocal,
          timezone: zone,
        });
        count++;
      } catch (e) {
        problems.push(`${row.fileName} / ${row.platform}: ${e instanceof Error ? e.message : 'Scheduling failed'}`);
      }
    }
    await refresh(`/projects/${projectId}/social-drafts`, '/publishing/matrix');
    setNotice(`${count} post(s) scheduled. No videos were published immediately.`);
    if (problems.length) setError(problems.slice(0, 8).join(' | '));
    setBusy(null);
    if (!problems.length) setScheduleOpen(false);
  }

  return (
    <Card>
      <CardTitle>Drive → ChatGPT → Publishing</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Select the videos to export. Nothing selected means every linked video. Drive Sync preserves a project folder and
        creates one editable JSON template per video and social account; ChatGPT can analyze the files and populate those templates.
      </p>
      {!drive.data?.configured ? (
        <div className="mb-3 space-y-2">
          <Notice tone="warn">Kemokem needs a separate Google Drive authorization. It requests access only to files it creates or that you explicitly grant to it.</Notice>
          <Button busy={busy === 'connect'} onClick={() => void connect()}>Connect Drive</Button>
        </div>
      ) : null}
      {items.length ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {items.map((item) => (
            <label key={item.itemId} className="flex max-w-64 items-center gap-2 rounded border border-border p-2 text-xs">
              <input
                type="checkbox"
                checked={selection.includes(item.itemId)}
                onChange={(e) => setSelection((current) => e.target.checked
                  ? [...current, item.itemId] : current.filter((id) => id !== item.itemId))}
                disabled={Boolean(running)}
              />
              <span className="truncate" title={item.fileName}>{item.fileName}</span>
            </label>
          ))}
        </div>
      ) : <p className="text-sm text-muted">Link videos to this project before syncing.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" busy={busy === 'sync' || Boolean(running)} disabled={!drive.data?.configured || items.length === 0 || Boolean(running)} onClick={() => void sync()}>
          {running ? `Processing ${drive.data?.job?.completed ?? 0}/${drive.data?.job?.total ?? 0}` : 'Drive Sync'}
        </Button>
        <label className={`cursor-pointer rounded-md border border-border px-3 py-2 text-sm ${drive.data?.job?.status !== 'COMPLETE' || metadataBusy ? 'opacity-50' : ''}`}>
          {metadataBusy ? 'Uploading JSON…' : 'Upload analysis JSON'}
          <input type="file" multiple accept=".json,application/json" className="sr-only"
            disabled={drive.data?.job?.status !== 'COMPLETE' || metadataBusy}
            onChange={(e) => {
              const files = e.target.files;
              void uploadJsonFiles(files);
              e.target.value = '';
            }}
          />
        </label>
        <Button busy={busy === 'prefill'} disabled={drive.data?.job?.status !== 'COMPLETE' || Boolean(running)} onClick={() => void prefill()}>
          Prefill socials
        </Button>
        <Button disabled={!scheduledRows.length} onClick={() => setScheduleOpen(true)}>Schedule videos</Button>
        {drive.data?.folderUrl ? (
          <a href={drive.data.folderUrl} target="_blank" rel="noreferrer" className="text-sm text-accent underline">Open Drive folder</a>
        ) : null}
      </div>
      {drive.data?.job?.status === 'FAILED' ? <p className="mt-2 text-sm text-bad">{drive.data.job.error}</p> : null}
      {notice ? <p className="mt-2 text-sm text-muted">{notice}</p> : null}
      {error ? <p className="mt-2 text-sm text-bad">{error}</p> : null}
      {prefillErrors.length ? (
        <details className="mt-2 rounded-lg border border-border p-2">
          <summary className="cursor-pointer text-sm font-semibold">
            {prefillErrors.length} prefill details — already published items are protected
          </summary>
          <div className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-muted">
            {prefillErrors.map((message, i) => <p key={i} className="break-all">{message}</p>)}
          </div>
        </details>
      ) : null}
      <Dialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Review and schedule videos" wide>
        <div className="space-y-4 p-4">
          <p className="text-sm text-muted">
            Defaults: first video tomorrow, next video the following day, and so on at 10:00 AM ({zone}).
            Every social account for the same video shares its date; uncheck any account you do not want to schedule.
            Scheduling is final only when you press Confirm schedule.
          </p>
          {readyVideos.map((video, idx) => {
            const options = scheduledRows.filter((row) => row.itemId === video.itemId);
            if (!options.length) return null;
            return (
              <div key={video.itemId} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[115px_1fr]">
                <VideoThumb fileId={video.fileInstanceId} online interactive={false} className="w-full" />
                <div className="min-w-0 space-y-2">
                  <p className="truncate text-sm font-semibold" title={video.fileName}>{video.fileName}</p>
                  <label className="block text-xs text-muted">
                    Scheduled date and time
                    <Input type="datetime-local"
                      value={dates[video.itemId] ?? tomorrowByZone(zone, idx + 1)}
                      onChange={(e) => setDates((d) => ({ ...d, [video.itemId]: e.target.value }))}
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {options.map((row) => (
                      <div key={keyOf(row)} className="flex items-center gap-2 rounded-md border border-border p-1.5">
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={selectedTargets.includes(keyOf(row))}
                            onChange={(e) => setSelectedTargets((old) => e.target.checked
                              ? [...old, keyOf(row)] : old.filter((key) => key !== keyOf(row)))} />
                          {row.platform} · {row.handle}
                        </label>
                        <Button size="sm" type="button" onClick={() => setCoverFor(row)}>
                          {savedCovers.includes(keyOf(row)) ? 'Edit cover ✓' : 'Design cover'}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          {error ? <p className="text-sm text-bad">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setScheduleOpen(false)} disabled={busy === 'schedule'}>Cancel</Button>
            <Button variant="primary" busy={busy === 'schedule'} onClick={() => void schedule()}>
              Confirm schedule
            </Button>
          </div>
        </div>
      </Dialog>
      {coverFor && (
        <SocialThumbnailStudio
          projectId={projectId}
          itemId={coverFor.itemId}
          accountId={coverFor.accountId}
          fileId={coverFor.fileInstanceId}
          fileName={coverFor.fileName}
          title={coverFor.title || ''}
          platform={coverFor.platform}
          contentForm={coverFor.contentForm ?? undefined}
          onClose={() => setCoverFor(null)}
          onSaved={() => {
            setSavedCovers((items) => [...new Set([...items, keyOf(coverFor)])]);
            setCoverFor(null);
            setNotice('Custom social thumbnail saved. It will be used where that platform supports an uploaded cover.');
          }}
        />
      )}
    </Card>
  );
}
