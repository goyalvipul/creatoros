#!/usr/bin/env node
/**
 * Kemokem streaming agent. It runs on the computer that encodes the livestream.
 * It calls the server. The server never opens a port on this computer.
 *
 *   KEMOKEM_URL=https://os.goyalfamily.ca KEMOKEM_TOKEN=csl_... node agent.mjs
 *
 * Heartbeat interval: KEMOKEM_HEARTBEAT_SEC (default 25).
 * Work files: KEMOKEM_DATA (default ~/.kemokem-stream).
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, lstat, mkdir, readdir, readFile, stat, statfs, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const base = (process.env.KEMOKEM_URL || '').replace(/\/$/, '');
const token = process.env.KEMOKEM_TOKEN || '';
const home = process.env.KEMOKEM_DATA || path.join(os.homedir(), '.kemokem-stream');
const savedJob = path.join(home, 'job.json');
const every = Math.max(15, Number(process.env.KEMOKEM_HEARTBEAT_SEC || 25)) * 1000;

if (!base || !token) {
  console.error('Set KEMOKEM_URL and KEMOKEM_TOKEN.');
  process.exit(1);
}

const state = {
  sessionId: null,
  phase: 'idle',
  ffmpeg: null,
  stopTimer: null,
  armedFor: null,
  busy: false,
  lastProgress: {},
  lastLog: '',
};

function redact(value) {
  return String(value).replace(/rtmps?:\/\/\S+/gi, 'rtmps://[redacted]').slice(-2000);
}

function osName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

async function api(pathname, options = {}) {
  const res = await fetch(`${base}/api/v1${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(redact(json?.error?.message || text || res.status));
  return json?.data;
}

function run(cmd, args, opts = {}) {
  return exec(cmd, args, { timeout: opts.timeout ?? 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
}

async function ffmpegInfo() {
  try {
    const { stdout } = await run('ffmpeg', ['-version'], { timeout: 10_000 });
    const version = stdout.split('\n')[0]?.slice(0, 80) || 'ffmpeg';
    const { stdout: enc } = await run('ffmpeg', ['-hide_banner', '-encoders'], { timeout: 10_000 });
    const encoders = ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_videotoolbox'].filter((name) => enc.includes(name));
    return { ffmpeg: version, encoders };
  } catch {
    return { ffmpeg: null, encoders: [] };
  }
}

async function disk() {
  try {
    const info = await statfs(home);
    return { freeBytes: Number(info.bavail) * Number(info.bsize), totalBytes: Number(info.blocks) * Number(info.bsize) };
  } catch {
    return { freeBytes: null, totalBytes: null };
  }
}

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], {
    timeout: 60_000,
  });
  const json = JSON.parse(stdout);
  const video = (json.streams || []).find((s) => s.codec_type === 'video');
  const audio = (json.streams || []).find((s) => s.codec_type === 'audio');
  const fps = video?.avg_frame_rate?.includes('/')
    ? Number(video.avg_frame_rate.split('/')[0]) / Number(video.avg_frame_rate.split('/')[1] || 1)
    : Number(video?.avg_frame_rate || 0);
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

function targetSize(resolution) {
  return resolution === '720p' ? [1280, 720] : [1920, 1080];
}

function compatible(info, resolution) {
  const [w, h] = targetSize(resolution);
  return (
    info.videoCodec === 'h264' &&
    info.hasAudio &&
    info.audioCodec === 'aac' &&
    info.sampleRate === 48000 &&
    info.channels === 2 &&
    info.width === w &&
    info.height === h &&
    Math.abs(info.fps - 30) < 0.2
  );
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function download(url, dest, expected) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  await pipeline(res.body, createWriteStream(dest));
  if (expected) {
    const got = await sha256(dest);
    if (got !== expected) throw new Error('The downloaded video did not match its checksum.');
  }
}

function quote(file) {
  return `file '${file.replace(/'/g, `'\\''`)}'`;
}

async function transcode(input, output, resolution, encoders, hasAudio) {
  const [w, h] = targetSize(resolution);
  const videoEncoder = encoders.includes('h264_nvenc') ? 'h264_nvenc' : 'libx264';
  const args = ['-y', '-hide_banner', '-i', input];
  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-shortest');
  args.push(
    '-vf',
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30`,
    '-c:v',
    videoEncoder,
    '-pix_fmt',
    'yuv420p',
    '-g',
    '60',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    output,
  );
  await run('ffmpeg', args, { timeout: 6 * 60 * 60 * 1000 });
}

function arm(stopAt) {
  if (!stopAt) return;
  const when = Date.parse(stopAt);
  if (Number.isNaN(when)) return;
  if (state.armedFor != null && state.armedFor <= when) return;
  if (state.stopTimer) clearTimeout(state.stopTimer);
  state.armedFor = when;
  state.stopTimer = setTimeout(() => {
    stopEncoder('deadline');
  }, Math.max(0, when - Date.now()));
}

function stopEncoder(reason) {
  const child = state.ffmpeg;
  if (!child || child.killed) return;
  if (reason === 'force') {
    child.kill('SIGKILL');
    return;
  }
  try {
    child.stdin?.write('q\n');
  } catch {
    child.kill('SIGINT');
  }
  setTimeout(() => {
    if (state.ffmpeg && state.ffmpeg.exitCode == null) state.ffmpeg.kill('SIGKILL');
  }, 20_000).unref();
}

async function materialize(file, dir, resolution, encoders) {
  if (file.source === 'agent') {
    if (!file.path || file.path.includes('..')) throw new Error('The video path was rejected.');
    await access(file.path);
    return file.path;
  }
  const cached = path.join(home, 'cache', file.sha256 || file.id);
  try {
    await access(cached);
    if (!file.sha256 || (await sha256(cached)) === file.sha256) return cached;
  } catch {
    /* download */
  }
  await mkdir(path.dirname(cached), { recursive: true });
  if (file.source === 'upload') {
    const res = await fetch(`${base}/api/v1/live/agent/file/${file.uploadId}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok || !res.body) throw new Error(`Kemokem could not send ${file.name}.`);
    const expected = res.headers.get('x-content-sha256');
    await pipeline(res.body, createWriteStream(cached));
    if (expected && (await sha256(cached)) !== expected) throw new Error(`${file.name} failed its checksum.`);
    return cached;
  }
  await download(file.url, cached, file.sha256);
  return cached;
}

async function prepare(job) {
  const dir = path.join(home, 'jobs', job.sessionId);
  await mkdir(dir, { recursive: true });
  const space = await disk();
  const ready = [];
  for (const file of job.files) {
    const local = await materialize(file, dir, job.resolution, []);
    const info = await probe(local);
    if (info.durationMs <= 0 || !info.width) throw Object.assign(new Error(`${file.name} is not a readable video.`), { code: 'ENCODER' });
    let used = local;
    if (!compatible(info, job.resolution)) {
      const infoNow = await ffmpegInfo();
      used = path.join(dir, `norm-${file.id}.mp4`);
      const fileStat = await statFile(local);
      if (space.freeBytes != null && space.freeBytes < fileStat * 2)
        throw Object.assign(new Error('Not enough free disk to prepare this video.'), { code: 'STORAGE' });
      await transcode(local, used, job.resolution, infoNow.encoders, info.hasAudio);
    }
    const after = await probe(used);
    ready.push({ id: file.id, durationMs: after.durationMs, width: after.width, height: after.height, hasAudio: after.hasAudio, validation: 'ok', file: used });
  }
  const list = path.join(dir, 'list.txt');
  await writeFile(list, ready.map((item) => quote(item.file)).join('\n'));
  const master = path.join(dir, 'master.mp4');
  await run('ffmpeg', ['-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', master], {
    timeout: 6 * 60 * 60 * 1000,
  });
  const masterInfo = await probe(master);
  if (!masterInfo.durationMs || !masterInfo.hasAudio) throw new Error('The combined video has no picture or no audio.');
  await api('/live/agent/report', {
    method: 'POST',
    body: {
      sessionId: job.sessionId,
      event: 'master_ready',
      items: ready.map(({ file: _file, ...item }) => item),
    },
  });
}

async function statFile(file) {
  const info = await stat(file);
  return info.size;
}

async function startEncoder(job) {
  if (!job.ingest?.address || !job.ingest?.name) return;
  if (job.stopAt && Date.parse(job.stopAt) <= Date.now()) {
    void api('/live/agent/report', { method: 'POST', body: { sessionId: job.sessionId, event: 'encoder_stopped', error: 'The deadline had already passed.' } });
    return;
  }
  const master = path.join(home, 'jobs', job.sessionId, 'master.mp4');
  try {
    await access(master);
  } catch {
    return;
  }
  const destination = `${job.ingest.address.replace(/\/$/, '')}/${job.ingest.name}`;
  const args = ['-hide_banner', '-loglevel', 'info', '-re'];
  if (job.loop !== false) args.push('-stream_loop', '-1');
  args.push('-i', master, '-c', 'copy', '-f', 'flv', destination);
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  state.ffmpeg = child;
  let log = '';
  child.stderr.on('data', (chunk) => {
    const line = redact(chunk.toString());
    log = (log + line).slice(-4000);
    state.lastLog = log;
    const fps = /fps=\s*([\d.]+)/.exec(line);
    const bitrate = /bitrate=\s*([^\s]+)/.exec(line);
    const speed = /speed=\s*([^\s]+)/.exec(line);
    const time = /time=\s*(\d+):(\d+):(\d+)/.exec(line);
    if (fps || bitrate || speed || time) {
      state.lastProgress = {
        fps: fps ? Number(fps[1]) : state.lastProgress.fps,
        bitrate: bitrate ? bitrate[1] : state.lastProgress.bitrate,
        speed: speed ? speed[1] : state.lastProgress.speed,
        outTimeMs: time ? (Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])) * 1000 : state.lastProgress.outTimeMs,
      };
    }
  });
  child.on('exit', () => {
    if (state.ffmpeg === child) state.ffmpeg = null;
    void api('/live/agent/report', {
      method: 'POST',
      body: { sessionId: job.sessionId, event: 'encoder_stopped', log: state.lastLog },
    }).catch(() => undefined);
  });
  void api('/live/agent/report', { method: 'POST', body: { sessionId: job.sessionId, event: 'encoder_started' } });
  arm(job.stopAt);
}

async function listing(browsePath) {
  if (!browsePath || browsePath.includes('..')) return null;
  const entries = [];
  let dirents = [];
  try {
    dirents = await readdir(browsePath, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of dirents) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const full = path.join(browsePath, entry.name);
    let info;
    try {
      info = await lstat(full);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) continue;
    const video = ['.mp4', '.mov', '.mkv', '.webm'].includes(path.extname(entry.name).toLowerCase());
    if (entry.isDirectory()) entries.push({ name: entry.name, relative: entry.name, kind: 'dir', size: 0 });
    else if (video) entries.push({ name: entry.name, relative: entry.name, kind: 'video', size: info.size });
    if (entries.length >= 400) break;
  }
  return entries;
}

async function tick() {
  const info = await ffmpegInfo();
  const space = await disk();
  const job = await api('/live/agent/job');
  const listed = job?.browsePath ? await listing(job.browsePath) : null;
  await api('/live/agent/heartbeat', {
    method: 'POST',
    body: { os: osName(), ffmpeg: info.ffmpeg, encoders: info.encoders, ...space, listing: listed },
  });
  if (!job || job.phase === 'idle') {
    if (state.ffmpeg) stopEncoder('stop');
    state.sessionId = null;
    state.armedFor = null;
    return;
  }
  if (state.sessionId !== job.sessionId) {
    if (state.ffmpeg) stopEncoder('stop');
    state.sessionId = job.sessionId;
    state.armedFor = null;
    state.busy = false;
  }
  if (job.phase === 'stop') {
    stopEncoder(job.force ? 'force' : 'stop');
    return;
  }
  if (job.phase === 'prepare') {
    if (job.prepareDeadline && Date.parse(job.prepareDeadline) <= Date.now()) {
      await api('/live/agent/report', {
        method: 'POST',
        body: { sessionId: job.sessionId, event: 'failed', code: 'WORKER', error: 'Preparation took too long.' },
      });
      return;
    }
    if (!state.busy) {
      state.busy = true;
      prepare(job)
        .catch(async (e) => {
          await api('/live/agent/report', {
            method: 'POST',
            body: { sessionId: job.sessionId, event: 'failed', code: e.code || 'ENCODER', error: redact(e.message || e) },
          }).catch(() => undefined);
        })
        .finally(() => {
          state.busy = false;
        });
    }
    return;
  }
  arm(job.stopAt);
  if (job.stopAt) await writeFile(savedJob, JSON.stringify({ sessionId: job.sessionId, stopAt: job.stopAt }));
  if (!state.ffmpeg && !state.busy) void startEncoder(job);
  else if (state.ffmpeg) {
    await api('/live/agent/report', {
      method: 'POST',
      body: { sessionId: job.sessionId, event: 'progress', progress: state.lastProgress, log: state.lastLog },
    }).catch(() => undefined);
  }
}

async function loop() {
  await mkdir(home, { recursive: true });
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error(redact(e instanceof Error ? e.message : e));
    }
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}

readFile(savedJob, 'utf8')
  .then((text) => {
    const job = JSON.parse(text);
    if (job?.stopAt) arm(job.stopAt);
  })
  .catch(() => undefined);

loop();
