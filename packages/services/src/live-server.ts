import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { eq, liveSessions, sql, type Db } from '@creatoros/db';
import { redactStreamSecrets, stopDue } from '@creatoros/domain';
import { decryptJson } from './crypto';
import { getDeviceSigningKey, signAgentFetch } from './devices';
import { applyLiveEvent, liveUploadPath } from './live-studio';
import type { ServiceEnv } from './types';

const exec = promisify(execFile);
const running = new Set<string>();
const procs = new Map<string, ChildProcess>();

type FetchFn = typeof fetch;

/** Unused by the worker. Encoding runs on the selected computer. Do not call this from the live job. */
export async function pumpServerLives(db: Db, env: ServiceEnv, fetchImpl: FetchFn = fetch) {
  const rows = await db
    .select()
    .from(liveSessions)
    .where(
      sql`${liveSessions.machineId} is null and ${liveSessions.status} in ('PREPARING','CREATING','CONNECTING','LIVE','INTERRUPTED','STOPPING')`,
    );
  const now = new Date();
  for (const row of rows) {
    const child = procs.get(row.id);
    if (row.status === 'STOPPING' || stopDue(now, row.autoStopAt, row.ingestSafetyAt)) {
      if (child && child.exitCode == null) {
        if (row.stopReason === 'EMERGENCY') child.kill('SIGKILL');
        else {
          try {
            child.stdin?.write('q\n');
          } catch {
            child.kill('SIGINT');
          }
        }
      }
      continue;
    }
    if (running.has(row.id)) continue;
    running.add(row.id);
    void runOne(db, env, row.id, fetchImpl).finally(() => running.delete(row.id));
  }
}

async function runOne(db: Db, env: ServiceEnv, sessionId: string, fetchImpl: FetchFn) {
  const [row] = await db.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
  if (!row || row.machineId || !['PREPARING', 'CREATING', 'CONNECTING', 'LIVE', 'INTERRUPTED'].includes(row.status)) return;
  const dir = path.join(path.dirname(env.liveUploadDir), 'live-jobs', sessionId);
  await mkdir(dir, { recursive: true });
  const master = path.join(dir, 'master.mp4');
  if (row.progress?.masterReady !== true) {
    try {
      const items = await buildMaster(db, env, row, dir, master);
      await applyLiveEvent(db, env, row, { event: 'master_ready', items }, fetchImpl);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await applyLiveEvent(db, env, row, { event: 'failed', code: message.includes('disk') ? 'STORAGE' : 'WORKER', error: message });
      return;
    }
  }
  const secret = await waitForIngest(db, env, sessionId);
  if (!secret) return;
  const [fresh] = await db.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
  if (!fresh || fresh.status === 'FAILED' || fresh.status === 'STOPPING' || fresh.status === 'ENDED') return;
  if (stopDue(new Date(), fresh.autoStopAt, fresh.ingestSafetyAt)) {
    await applyLiveEvent(db, env, fresh, { event: 'encoder_stopped', error: 'The deadline had already passed.' });
    return;
  }
  await streamMaster(db, env, fresh, master, secret);
}

async function waitForIngest(db: Db, env: ServiceEnv, sessionId: string) {
  for (let i = 0; i < 40; i++) {
    const [row] = await db.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
    if (!row || row.status === 'FAILED' || row.status === 'ENDED' || row.status === 'STOPPING') return null;
    if (row.ingestSecret && ['CONNECTING', 'LIVE', 'INTERRUPTED'].includes(row.status))
      return decryptJson<{ address: string; name: string }>(row.ingestSecret, env.encryptionKey);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

async function buildMaster(db: Db, env: ServiceEnv, row: typeof liveSessions.$inferSelect, dir: string, master: string) {
  const settings = (row.settings ?? {}) as { resolution?: string };
  const resolution = settings.resolution === '720p' ? '720p' : '1080p';
  const items = Array.isArray(row.playlistSnapshot) ? row.playlistSnapshot : [];
  const ready: { id: string; source: 'library' | 'upload'; name: string; durationMs: number; width: number; height: number; hasAudio: boolean; validation: 'ok'; file: string }[] = [];
  for (const item of items) {
    const source = item as { id?: string; source?: string; fileInstanceId?: string; uploadId?: string; name?: string; sha256?: string };
    const local = path.join(dir, `src-${source.id}`);
    if (source.source === 'upload' && source.uploadId) await copyFile(liveUploadPath(env, row.orgId, source.uploadId), local);
    else if (source.source === 'library' && source.fileInstanceId) await pullLibraryFile(db, env, row.orgId, source.fileInstanceId, local, source.sha256);
    else throw new Error(`${source.name || 'A video'} is not in the library and was not uploaded.`);
    const info = await probe(local);
    if (info.durationMs <= 0 || !info.width) throw new Error(`${source.name || 'A video'} is not a readable video.`);
    let used = local;
    if (!compatible(info, resolution)) {
      used = path.join(dir, `norm-${source.id}.mp4`);
      await transcode(local, used, resolution, info.hasAudio);
    }
    const after = await probe(used);
    ready.push({ id: String(source.id), source: source.source === 'upload' ? 'upload' : 'library', name: source.name || 'video', durationMs: after.durationMs, width: after.width, height: after.height, hasAudio: after.hasAudio, validation: 'ok', file: used });
  }
  const list = path.join(dir, 'list.txt');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(list, ready.map((item) => `file '${item.file.replace(/'/g, `'\\''`)}'`).join('\n'));
  await exec('ffmpeg', ['-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', master], { timeout: 6 * 60 * 60 * 1000 });
  const masterInfo = await probe(master);
  if (!masterInfo.durationMs || !masterInfo.hasAudio) throw new Error('The combined video has no picture or no audio.');
  return ready.map(({ file: _file, ...item }) => item);
}

async function pullLibraryFile(db: Db, env: ServiceEnv, orgId: string, fileId: string, dest: string, sha256?: string | null) {
  const found = (await db.execute(sql`
    select f.root_id as "rootId", f.display_path as "displayPath", f.full_hash as "fullHash",
           d.id as "deviceId", d.state as "deviceState", d.listen_urls as "listenUrls"
    from file_instances f join devices d on d.id = f.device_id
    where f.id = ${fileId} and f.org_id = ${orgId}`)) as unknown as { rows: { rootId: string; displayPath: string; fullHash: string | null; deviceId: string; deviceState: string; listenUrls: string[] }[] };
  const file = found.rows[0];
  if (!file) throw new Error('That library file is no longer indexed.');
  if (file.deviceState !== 'ONLINE') throw new Error('The library computer that holds a chosen video is off.');
  const key = await getDeviceSigningKey(env, file.deviceId, db);
  if (!key) throw new Error('The library agent cannot serve this file.');
  const exp = Math.floor(Date.now() / 1000) + 600;
  const sig = signAgentFetch(key, file.rootId, file.displayPath, exp);
  const loopback = env.processEnv.AGENT_LOOPBACK_HOST;
  const urls = (file.listenUrls ?? []).map((url) => (loopback ? url.replace(/\/\/(127\.0\.0\.1|localhost)/, `//${loopback}`) : url));
  let upstream: Response | null = null;
  let last = '';
  for (const base of urls) {
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/v1/stream?root=${encodeURIComponent(file.rootId)}&path=${encodeURIComponent(file.displayPath)}&exp=${exp}&sig=${sig}`);
      if (res.ok && res.body) {
        upstream = res;
        break;
      }
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  if (!upstream?.body) throw new Error(`Could not read the library file (${last}).`);
  await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream), createWriteStream(dest));
  const expected = sha256 || file.fullHash;
  if (expected) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(dest), hash);
    if (hash.digest('hex') !== expected) throw new Error('A library file did not match its checksum.');
  }
}

function targetSize(resolution: string) {
  return resolution === '720p' ? [1280, 720] : [1920, 1080];
}

async function probe(file: string) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeout: 60_000 });
  const json = JSON.parse(stdout) as { streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; sample_rate?: string; channels?: number }[]; format?: { duration?: string } };
  const video = json.streams?.find((s) => s.codec_type === 'video');
  const audio = json.streams?.find((s) => s.codec_type === 'audio');
  const rate = video?.avg_frame_rate ?? '0';
  const [num, den] = rate.split('/').map(Number);
  const fps = den ? num / den : Number(rate);
  return {
    durationMs: Math.round(Number(json.format?.duration || 0) * 1000),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name || '',
    audioCodec: audio?.codec_name || '',
    sampleRate: Number(audio?.sample_rate || 0),
    channels: Number(audio?.channels || 0),
    fps,
  };
}

function compatible(info: Awaited<ReturnType<typeof probe>>, resolution: string) {
  const [w, h] = targetSize(resolution);
  return info.videoCodec === 'h264' && info.hasAudio && info.audioCodec === 'aac' && info.sampleRate === 48000 && info.channels === 2 && info.width === w && info.height === h && Math.abs(info.fps - 30) < 0.2;
}

async function transcode(input: string, output: string, resolution: string, hasAudio: boolean) {
  const [w, h] = targetSize(resolution);
  const args = ['-y', '-hide_banner', '-i', input];
  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-shortest');
  args.push('-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', output);
  await exec('ffmpeg', args, { timeout: 6 * 60 * 60 * 1000 });
}

async function streamMaster(db: Db, env: ServiceEnv, row: typeof liveSessions.$inferSelect, master: string, secret: { address: string; name: string }) {
  await stat(master);
  const settings = (row.settings ?? {}) as { loop?: boolean };
  const destination = `${secret.address.replace(/\/$/, '')}/${secret.name}`;
  const args = ['-hide_banner', '-loglevel', 'info', '-re'];
  if (settings.loop !== false) args.push('-stream_loop', '-1');
  args.push('-i', master, '-c', 'copy', '-f', 'flv', destination);
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  procs.set(row.id, child);
  let log = '';
  const progress: Record<string, unknown> = {};
  child.stderr.on('data', (chunk) => {
    const line = redactStreamSecrets(String(chunk));
    log = (log + line).slice(-4000);
    const fps = /fps=\s*([\d.]+)/.exec(line);
    const bitrate = /bitrate=\s*([^\s]+)/.exec(line);
    const speed = /speed=\s*([^\s]+)/.exec(line);
    const time = /time=\s*(\d+):(\d+):(\d+)/.exec(line);
    if (fps) progress.fps = Number(fps[1]);
    if (bitrate) progress.bitrate = bitrate[1];
    if (speed) progress.speed = speed[1];
    if (time) progress.outTimeMs = (Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])) * 1000;
  });
  const beat = setInterval(() => {
    void applyLiveEvent(db, env, row, { event: 'progress', progress, log }).catch(() => undefined);
  }, 20_000);
  await applyLiveEvent(db, env, row, { event: 'encoder_started' });
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  clearInterval(beat);
  procs.delete(row.id);
  const [latest] = await db.select().from(liveSessions).where(eq(liveSessions.id, row.id));
  if (latest && latest.status !== 'FAILED' && latest.status !== 'ENDED')
    await applyLiveEvent(db, env, latest, { event: 'encoder_stopped', log });
}
