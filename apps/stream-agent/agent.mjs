#!/usr/bin/env node

/**

 * Kemokem streaming agent. It runs on the computer that encodes the livestream.

 * Makes outbound HTTPS requests. No inbound port is required.

 */

import { execFile, spawn } from 'node:child_process';

import { createHash } from 'node:crypto';

import { createReadStream, createWriteStream } from 'node:fs';

import { access, lstat, mkdir, open, readdir, readFile, rename, stat, statfs, unlink, writeFile } from 'node:fs/promises';

import os from 'node:os';

import path from 'node:path';

import { pipeline } from 'node:stream/promises';

import { promisify } from 'node:util';

const exec = promisify(execFile);

const base = (process.env.KEMOKEM_URL || '').replace(/\/$/, '');

const token = process.env.KEMOKEM_TOKEN || '';

const home = process.env.KEMOKEM_DATA || path.join(os.homedir(), '.kemokem-stream');

const mediaRoot = process.env.KEMOKEM_MEDIA || (process.platform === 'win32' ? 'C:\\MehakLive' : path.join(home, 'media'));

const normDir = path.join(mediaRoot, 'normalized');

const streamDir = path.join(mediaRoot, 'stream');

const liveFile = path.join(streamDir, 'live.mp4');

const liveTemp = path.join(streamDir, 'live.building.mp4');

const livePlan = path.join(streamDir, 'live.plan.json');

const NORM_PROFILE = 'h264-1920x1080-30-yuv420p-aac-192k-48000-2-g60';

const savedJob = path.join(home, 'job.json');

const agentLogPath = process.env.KEMOKEM_LOG || (process.platform === 'win32' ? 'C:\\ProgramData\\KemokemAgent\\logs\\agent.log' : path.join(home, 'agent.log'));

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

  finishedPreparation: null,

  failedPreparation: null,

  lastObservedJob: null,

  stopRequested: false,
  encoderStartPending: false,
  failedEncoderSession: null,
  finishedEncoderSession: null,
  encoderContext: null,
  launchEpoch: 0,
  deadlineSessionId: null,
  activeStreamKey: null,
  deadlineReportedSession: null,

};

function redact(value) {
  let result = String(value ?? '');
  // Protect secrets even when FFmpeg/Node prints just the stream name instead of its URL.
  if (token) result = result.split(token).join('[redacted]');
  if (state.activeStreamKey) result = result.split(state.activeStreamKey).join('[redacted]');
  return result.replace(/rtmps?:\/\/[^\s"']+/gi, 'rtmps://[redacted]').slice(-2000);
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

  return exec(cmd, args, { timeout: opts.timeout ?? 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });

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

    pixFmt: video?.pix_fmt || '',

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

function matchesProfile(info, resolution) {

const [w, h] = targetSize(resolution);

  return (

    info.videoCodec === 'h264' &&

    info.pixFmt === 'yuv420p' &&

    info.hasAudio &&

    info.audioCodec === 'aac' &&

    info.sampleRate === 48000 &&

    info.channels === 2 &&

    info.width === w &&

    info.height === h &&

    Math.abs((info.fps || 0) - 30) < 0.2 &&

    info.durationMs > 0

  );

}

function sourceMark(fileStat, resolution) {

const [w, h] = targetSize(resolution);

  return { size: fileStat.size, mtimeMs: Math.round(fileStat.mtimeMs), profile: `${NORM_PROFILE}-${w}x${h}` };

}

async function readJson(file) {

  try {

    return JSON.parse(await readFile(file, 'utf8'));

  } catch {

    return null;

  }

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

  return `file '${file.replace(/\\/g, '/').replace(/'/g, `'\\\''`)}'`;

}

async function transcode(input, output, resolution, hasAudio) {

const [w, h] = targetSize(resolution);

const args = ['-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-fflags', '+genpts', '-i', input];

  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');

  args.push(

    '-map',

    '0:v:0',

    '-map',

    hasAudio ? '0:a:0' : '1:a:0',

  );

  if (!hasAudio) args.push('-shortest');

  args.push(

    '-vf',

    `fps=30,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,

    '-c:v',

    'libx264',

    '-preset',

    'veryfast',

    '-crf',

    '20',

    '-r',

    '30',

    '-g',

    '60',

    '-keyint_min',

    '60',

    '-sc_threshold',

    '0',

    '-c:a',

    'aac',

    '-b:a',

    '192k',

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

// A timer must only ever control the session it was created for.
function cancelDeadline() {
  if (state.stopTimer) clearTimeout(state.stopTimer);
  state.stopTimer = null;
  state.armedFor = null;
  state.deadlineSessionId = null;
}

function arm(stopAt, sessionId) {
  const when = Date.parse(stopAt || '');
  if (!sessionId || !Number.isFinite(when)) return false;
  if (state.stopTimer && state.deadlineSessionId === sessionId && state.armedFor === when) return true;
  cancelDeadline();
  state.armedFor = when;
  state.deadlineSessionId = sessionId;
  const check = () => {
    if (state.deadlineSessionId !== sessionId || state.sessionId !== sessionId || state.phase !== 'stream') return;
    const remaining = when - Date.now();
    if (remaining > 0) {
      state.stopTimer = setTimeout(check, Math.min(remaining, 2_000_000_000));
      return;
    }
    state.stopTimer = null;
    state.failedEncoderSession = sessionId; // Never restart this session after its deadline.
    const hadEncoder = Boolean(state.encoderContext && state.encoderContext.sessionId === sessionId);
    stopEncoder('deadline');
    if (!hadEncoder && state.deadlineReportedSession !== sessionId) {
      state.deadlineReportedSession = sessionId;
      state.finishedEncoderSession = sessionId;
      void api('/live/agent/report', { method: 'POST', body: {
        sessionId, event: 'encoder_stopped', error: 'Stream deadline has passed.',
      }}).catch((e) => console.error(`[Kemokem deadline] ${redact(e.message)}`));
    }
  };
  state.stopTimer = setTimeout(check, Math.min(Math.max(0, when - Date.now()), 2_000_000_000));
  return true;
}

// Use the earliest known deadline for the same session. This protects against
// server restarts, reissued jobs and accidental extensions of a live session.
async function deadlineFor(job) {
  const saved = await readJson(savedJob);
  const requested = Date.parse(job.stopAt || '');
  const now = Date.now();
  const firstAllowed = now + 655 * 60_000;
  let deadline = Number.isFinite(requested) ? Math.min(requested, firstAllowed) : firstAllowed;
  if (saved?.sessionId === job.sessionId) {
    const prior = Date.parse(saved.stopAt || '');
    if (Number.isFinite(prior)) deadline = Math.min(deadline, prior);
  }
  const stopAt = new Date(deadline).toISOString();
  if (saved?.sessionId !== job.sessionId || saved.stopAt !== stopAt) {
    await writeFile(savedJob, JSON.stringify({ sessionId: job.sessionId, stopAt }));
  }
  return stopAt;
}

function killEncoder(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  try { child.kill(process.platform === 'win32' ? undefined : 'SIGKILL'); }
  catch (e) { console.error(`[Kemokem stop] ${redact(e.message)}`); }
}

function stopEncoder(reason) {
  const context = state.encoderContext;
  if (!context || context.child.exitCode != null || context.child.signalCode != null) return;
  if (context.requestedStop && reason !== 'force') return;
  context.requestedStop = true;
  state.stopRequested = true;
  const child = context.child; // Capture the original child, not the mutable state.ffmpeg.
  if (reason === 'force') {
    killEncoder(child);
    return;
  }
  try {
    if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) throw new Error('FFmpeg stdin unavailable');
    child.stdin.write('q\n');
  } catch (e) {
    console.error(`[Kemokem stop] Graceful stop unavailable: ${redact(e.message)}`);
    killEncoder(child);
    return;
  }
  context.stopTimeout = setTimeout(() => killEncoder(child), 20_000);
  context.stopTimeout.unref();
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

  if (!job.sessionId || !Array.isArray(job.files) || job.files.length === 0) {

    throw Object.assign(new Error('Prepare job has no sessionId or selected files. Check the server Make one video handler and /live/agent/job payload.'), { code: 'WORKER' });

  }

  console.log(`[Kemokem prepare] session=${job.sessionId} files=${job.files.length} resolution=${job.resolution || '1080p'} folder=${mediaRoot}`);

// The existing server protocol expects these same event names.

  await api('/live/agent/report', { method: 'POST', body: {

    sessionId: job.sessionId, event: 'progress', log: `Preparation accepted by Windows agent: ${job.files.length} selected videos.`,

  } }).catch((e) => console.error(`[Kemokem prepare] Initial status delivery failed: ${redact(e.message)}`));

  await mkdir(normDir, { recursive: true });

  await mkdir(streamDir, { recursive: true });

const ready = [];

const marks = [];

  for (let index = 0; index < job.files.length; index += 1) {

const file = job.files[index];

const name = path.basename(file.path || file.name || '');

const local = path.resolve(file.path || '');

const root = path.resolve(mediaRoot);

const lower = name.toLowerCase();

    if (

      file.source !== 'agent' ||

      !local.toLowerCase().startsWith(root.toLowerCase() + path.sep) ||

      lower === 'live.mp4' ||

      lower === 'live.building.mp4'

    ) {

      throw Object.assign(new Error(`${file.name || 'A video'} is not a source file inside ${mediaRoot}.`), { code: 'ENCODER' });

    }

const srcStat = await stat(local);

const mark = sourceMark(srcStat, job.resolution);

const out = path.join(normDir, name);

const note = path.join(normDir, `${name}.norm.json`);

const saved = await readJson(note);

let info = null;

    if (saved && saved.size === mark.size && saved.mtimeMs === mark.mtimeMs && saved.profile === mark.profile) {

      try {

        info = await probe(out);

      } catch {

        info = null;

      }

    }

    if (!info || !matchesProfile(info, job.resolution)) {

      console.log(`[Kemokem prepare] Normalizing ${index + 1}/${job.files.length}: ${name}`);

      await api('/live/agent/report', { method: 'POST', body: {

        sessionId: job.sessionId, event: 'progress', log: `Normalizing ${index + 1}/${job.files.length}: ${name}`,

      } }).catch(() => undefined);

const src = await probe(local);

      if (src.durationMs <= 0 || !src.width) throw Object.assign(new Error(`${name} is not a readable video.`), { code: 'ENCODER' });

const partial = `${out}.part.mp4`;

      await transcode(local, partial, job.resolution, src.hasAudio);

      info = await probe(partial);

      if (!matchesProfile(info, job.resolution)) throw Object.assign(new Error(`${name} did not normalize to the required format.`), { code: 'ENCODER' });

      await rename(partial, out);

      await writeFile(note, JSON.stringify(mark));

    } else {

      console.log(`[Kemokem prepare] Cache hit ${index + 1}/${job.files.length}: ${name}`);

    }

    marks.push({ name, ...mark });

    ready.push({ id: file.id, durationMs: info.durationMs, width: info.width, height: info.height, hasAudio: info.hasAudio, validation: 'ok', file: out });

    await api('/live/agent/report', {

      method: 'POST',

      body: { sessionId: job.sessionId, event: 'progress', log: `Normalized ${index + 1} of ${job.files.length}: ${name}` },

    }).catch(() => undefined);

  }

const same = JSON.stringify(marks);

const previous = await readJson(livePlan);

let masterInfo = null;

  try {

    masterInfo = await probe(liveFile);

  } catch {

    masterInfo = null;

  }

  if (!(previous && JSON.stringify(previous) === same && masterInfo && matchesProfile(masterInfo, job.resolution))) {

    if (state.ffmpeg && state.ffmpeg.exitCode == null) {

      throw Object.assign(new Error('A livestream is reading live.mp4. Stop it before replacing that file. The current master was left in place.'), { code: 'ENCODER' });

    }

const list = path.join(normDir, 'list.txt');

    await writeFile(list, `${ready.map((item) => quote(item.file)).join('\n')}\n`);

    console.log(`[Kemokem prepare] Concatenating ${ready.length} normalized clips to ${liveTemp}`);

    await api('/live/agent/report', { method: 'POST', body: {

      sessionId: job.sessionId, event: 'progress', log: `Combining ${ready.length} clips into live.mp4`,

    } }).catch(() => undefined);

    try {

      await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', liveTemp], {

        timeout: 6 * 60 * 60 * 1000,

      });

const built = await probe(liveTemp);

      if (!built.durationMs || !built.hasAudio || !matchesProfile(built, job.resolution)) {

        await unlink(liveTemp).catch(() => undefined);

        throw new Error('The combined video has no matching picture or audio. The existing live.mp4 was left in place.');

      }

    } catch (e) {

      await unlink(liveTemp).catch(() => undefined);

      throw e;

    }

const backup = `${liveFile}.bak-${process.pid}-${Date.now()}`;

let had = false;

    try {

      await rename(liveFile, backup);

      had = true;

    } catch (e) {

      if (e.code !== 'ENOENT') {

// A locked/permission-denied old master is NOT the same as no old master.

        throw new Error(`Cannot safely replace existing live.mp4: ${e.message}`);

      }

    }

    try {

      await rename(liveTemp, liveFile);

    } catch (e) {

      if (had) {

        await rename(backup, liveFile).catch((restoreError) => {

          console.error(`[Kemokem prepare] CRITICAL: rollback failed; previous master at ${backup}: ${redact(restoreError.message)}`);

        });

      }

      throw e;

    }

    if (had) await unlink(backup).catch(() => undefined);

    await writeFile(livePlan, same);

  } else {

    console.log('[Kemokem prepare] Existing master matches playlist and profile; reusing live.mp4');

  }

  console.log(`[Kemokem prepare] Master ready: ${liveFile}`);

  await api('/live/agent/report', {

    method: 'POST',

    body: {

      sessionId: job.sessionId,

      event: 'master_ready',

      savedPath: liveFile,

      items: ready.map(({ file: _file, ...item }) => item),

    },

  });

}

async function statFile(file) {

const info = await stat(file);

  return info.size;

}

// Terminal streaming failures use the same established `failed` event as preparation.
// A per-session latch prevents another launch every heartbeat on a failed job.
async function reportStream(job, error) {
  const message = redact(error instanceof Error ? error.message : error);
  state.failedEncoderSession = job.sessionId;
  console.error(`[Kemokem stream] ${message}`);
  try {
    await api('/live/agent/report', { method: 'POST', body: {
      sessionId: job.sessionId, event: 'failed', code: 'ENCODER', error: message, log: message,
    }});
  } catch (e) {
    console.error(`[Kemokem stream] Could not report failure: ${redact(e.message)}`);
  }
}

async function startEncoder(job) {
  if (!job?.sessionId || state.encoderStartPending || state.encoderContext ||
      state.failedEncoderSession === job.sessionId || state.finishedEncoderSession === job.sessionId) return;
  if (state.sessionId !== job.sessionId || state.phase !== 'stream') return;
  state.encoderStartPending = true;
  const epoch = state.launchEpoch;
  try {
    const ingest = job.ingest || {};
    const address = ingest.rtmpsIngestionAddress || ingest.address || ingest.ingestionAddress;
    const streamName = ingest.name || ingest.streamName;
    if (!address || !streamName) throw new Error('YouTube ingest address or stream key is missing from the streaming job.');
    if (!/^rtmps?:\/\//i.test(address)) throw new Error('YouTube ingest address must use RTMP or RTMPS.');
    if (job.stopAt && Date.parse(job.stopAt) <= Date.now()) throw new Error('The server stream deadline has passed.');
    if (state.armedFor != null && Date.now() >= state.armedFor) throw new Error('The preserved stream deadline has passed.');
    const master = job.masterPath || liveFile;
    // A pre-migration job may still point at C:\MehakLive\live.mp4. Never
    // silently broadcast that stale file when the approved master is in stream/.
    const legacyMaster = path.join(mediaRoot, 'live.mp4');
    if (path.resolve(master).toLowerCase() === path.resolve(legacyMaster).toLowerCase()) {
      throw new Error(`Backend returned the old master path (${master}). Expected ${liveFile}; update the existing Go Live job payload.`);
    }
    const checked = await probe(master);
    if (!checked.hasAudio || !checked.durationMs || checked.videoCodec !== 'h264' || checked.audioCodec !== 'aac') {
      throw new Error(`Master video is not a valid H.264/AAC stream: ${master}`);
    }
    // A STOP/HOLD/IDLE or session change while ffprobe ran cancels this launch.
    if (epoch !== state.launchEpoch || state.sessionId !== job.sessionId || state.phase !== 'stream' ||
        state.encoderContext || state.failedEncoderSession === job.sessionId) return;
    if (state.armedFor != null && Date.now() >= state.armedFor) throw new Error('The stream deadline expired before FFmpeg started.');
    const destination = `${String(address).replace(/\/$/, '')}/${streamName}`;
    const args = ['-hide_banner', '-loglevel', 'info', '-re'];
    if (job.loop !== false) args.push('-stream_loop', '-1');
    args.push('-i', master, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'copy', '-f', 'flv', destination);
    state.activeStreamKey = String(streamName);
    state.lastLog = '';
    state.lastProgress = {};
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    const context = { child, sessionId: job.sessionId, requestedStop: false, stopTimeout: null, terminal: false, reportedStart: false };
    state.encoderContext = context;
    state.ffmpeg = child;
    state.stopRequested = false;
    console.log(`[Kemokem stream] Launch requested session=${job.sessionId} master=${master} ingest=[redacted]`);

    // FFmpeg can emit EPIPE on stdin after it exits; don't let this crash Node.
    child.stdin?.on('error', (err) => console.error(`[Kemokem stream] FFmpeg stdin: ${redact(err.message)}`));
    child.on('spawn', () => console.log(`[Kemokem stream] FFmpeg spawned PID=${child.pid} session=${job.sessionId}`));
    child.on('error', (err) => {
      if (context.terminal) return;
      context.spawnError = err;
      void reportStream(job, `FFmpeg failed to spawn: ${err.message}`);
    });
    child.stderr?.on('data', (chunk) => {
      const line = redact(chunk.toString());
      state.lastLog = (state.lastLog + line).slice(-4000);
      const fps = /fps=\s*([\d.]+)/.exec(line);
      const bitrate = /bitrate=\s*([^\s]+)/.exec(line);
      const speed = /speed=\s*([^\s]+)/.exec(line);
      const time = /time=\s*(\d+):(\d+):(\d+)/.exec(line);
      if (!context.reportedStart && (fps || time)) {
        context.reportedStart = true;
        void api('/live/agent/report', { method: 'POST', body: {
          sessionId: job.sessionId, event: 'encoder_started', log: state.lastLog,
        }}).catch((e) => console.error(`[Kemokem stream] encoder_started report failed: ${redact(e.message)}`));
      }
      if (fps || bitrate || speed || time) {
        state.lastProgress = {
          fps: fps ? Number(fps[1]) : state.lastProgress.fps,
          bitrate: bitrate ? bitrate[1] : state.lastProgress.bitrate,
          speed: speed ? speed[1] : state.lastProgress.speed,
          outTimeMs: time ? (Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])) * 1000 : state.lastProgress.outTimeMs,
        };
      }
    });
    child.on('close', (code, signal) => {
      if (context.terminal) return;
      context.terminal = true;
      if (context.stopTimeout) clearTimeout(context.stopTimeout);
      if (state.encoderContext === context) {
        state.encoderContext = null;
        state.ffmpeg = null;
        state.activeStreamKey = null;
      }
      if (context.spawnError) return; // error handler already reported failure
      if (context.requestedStop || (code === 0 && job.loop === false)) {
        state.finishedEncoderSession = job.sessionId;
        void api('/live/agent/report', { method: 'POST', body: {
          sessionId: job.sessionId, event: 'encoder_stopped', log: state.lastLog,
        }}).catch((e) => console.error(`[Kemokem stream] encoder_stopped report failed: ${redact(e.message)}`));
      } else {
        void reportStream(job, `FFmpeg exited unexpectedly (${code ?? signal ?? 'unknown'}). ${state.lastLog || 'No FFmpeg output.'}`);
      }
    });
  } catch (e) {
    await reportStream(job, `FFmpeg did not start: ${e instanceof Error ? e.message : e}`);
  } finally {
    state.encoderStartPending = false;
  }
}

async function existingMaster() {

const candidates = [{ file: liveFile, relative: 'stream/live.mp4' }];

  for (const candidate of candidates) {

    try {

const info = await stat(candidate.file);

      if (info.isFile() && info.size > 0) return { relative: candidate.relative, size: info.size };

    } catch {

// The other location may still have the saved stream.

    }

  }

  return null;

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

const lowerName = entry.name.toLowerCase();

    if (

      lowerName === 'normalised' ||

      lowerName === 'normalized' ||

      lowerName === 'stream' ||

      lowerName === 'live.mp4' ||

      lowerName === 'live.building.mp4' ||

      lowerName === 'live.mp4.bak' ||

      lowerName === 'live.plan.json' ||

      lowerName === 'list.txt' ||

      lowerName.endsWith('.norm.json')

    )

      continue;

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

async function agentLogTail() {

let fh;

  try {

    fh = await open(agentLogPath, 'r');

const size = (await fh.stat()).size;

const chunk = Math.min(size, 64 * 1024);

const buf = Buffer.alloc(chunk);

    await fh.read(buf, 0, chunk, Math.max(0, size - chunk));

const text = buf.toString('utf8').replace(/^\uFFFD?/, '');

const lines = text.split(/\r?\n/);

    if (size > chunk) lines.shift();

    return lines.filter((line) => line.length > 0).slice(-35).join('\n');

  } catch {

    return `Agent log file was not found: ${agentLogPath}`;

  } finally {

    await fh?.close();

  }

}

async function tick() {
  const info = await ffmpegInfo();
  const space = await disk();
  const job = await api('/live/agent/job');
  const jobSignature = `${job?.sessionId || 'none'}:${job?.phase || 'idle'}`;
  if (state.lastObservedJob !== jobSignature) {
    state.lastObservedJob = jobSignature;
    console.log(`[Kemokem agent] Server job: phase=${job?.phase || 'idle'} session=${job?.sessionId || 'none'} files=${Array.isArray(job?.files) ? job.files.length : 'n/a'}`);
  }
  const listed = await listing(job?.browsePath || mediaRoot);
  const master = await existingMaster();
  if (master && Array.isArray(listed)) listed.push({ name: 'live.mp4', relative: master.relative, kind: 'master', size: master.size });
  await api('/live/agent/heartbeat', { method: 'POST', body: {
    os: osName(), hostname: os.hostname(), ffmpeg: info.ffmpeg, encoders: info.encoders,
    ...space, listing: listed, agentLog: redact(await agentLogTail()),
  }});

  const phase = job?.phase || 'idle';
  const sessionId = phase === 'idle' ? null : job?.sessionId || null;
  const changedSession = state.sessionId !== sessionId;
  const changedPhase = state.phase !== phase;
  if (changedSession || changedPhase) {
    state.launchEpoch += 1; // Invalidates in-flight ffprobe/start operations.
    state.phase = phase;
    cancelDeadline();
    if (changedSession) {
      if (state.encoderContext && state.encoderContext.sessionId !== sessionId) stopEncoder('stop');
      state.sessionId = sessionId;
      state.finishedPreparation = null;
      state.failedPreparation = null;
      state.failedEncoderSession = null;
      state.finishedEncoderSession = null;
      state.deadlineReportedSession = null;
    } else if (phase === 'stream') {
      // A user deliberately returned from HOLD/STOP to Go Live in the same session.
      state.failedEncoderSession = null;
      state.finishedEncoderSession = null;
      state.deadlineReportedSession = null;
    }
  }

  if (phase === 'idle') {
    if (state.encoderContext) stopEncoder('stop');
    return;
  }
  if (!sessionId) {
    console.error(`[Kemokem agent] Server returned ${phase} without sessionId.`);
    return;
  }
  if (phase === 'hold') {
    // HOLD means master prepared, waiting for Go Live; it does not start an encoder.
    if (state.encoderContext) stopEncoder('stop');
    return;
  }
  if (phase === 'stop') {
    stopEncoder(job.force ? 'force' : 'stop');
    return;
  }
  if (phase === 'prepare') {
    if (state.encoderContext) {
      console.error('[Kemokem prepare] Cannot replace a master while FFmpeg is streaming.');
      return;
    }
    if (job.prepareDeadline && Date.parse(job.prepareDeadline) <= Date.now()) {
      await api('/live/agent/report', { method: 'POST', body: {
        sessionId: job.sessionId, event: 'failed', code: 'WORKER', error: 'Preparation took too long.',
      }});
      return;
    }
    if (!state.busy && state.finishedPreparation !== sessionId && state.failedPreparation !== sessionId) {
      state.busy = true;
      console.log(`[Kemokem prepare] Starting session=${sessionId}`);
      prepare(job)
        .then(() => {
          state.finishedPreparation = sessionId;
          console.log(`[Kemokem prepare] Completed session=${sessionId}`);
        })
        .catch(async (e) => {
          state.failedPreparation = sessionId;
          const message = redact(e?.stderr || e?.message || e);
          console.error(`[Kemokem prepare] FAILED session=${sessionId}: ${message}`);
          await api('/live/agent/report', { method: 'POST', body: {
            sessionId, event: 'failed', code: e.code || 'ENCODER', error: message,
          }}).catch((reportError) => console.error(`[Kemokem prepare] Error report failed: ${redact(reportError.message)}`));
        })
        .finally(() => { state.busy = false; });
    }
    return;
  }
  if (phase !== 'stream') return; // Explicit allowlist; unknown phases cannot start FFmpeg.

  // Persistent earlier-of policy: no retry or reboot may extend this session's deadline.
  const stopAt = await deadlineFor(job);
  arm(stopAt, sessionId);
  if (Date.now() >= Date.parse(stopAt)) {
    state.failedEncoderSession = sessionId;
    if (state.encoderContext) stopEncoder('deadline');
    else if (state.deadlineReportedSession !== sessionId) {
      state.deadlineReportedSession = sessionId;
      state.finishedEncoderSession = sessionId;
      await api('/live/agent/report', { method: 'POST', body: {
        sessionId, event: 'encoder_stopped', error: 'Stream deadline has passed.',
      }}).catch((e) => console.error(`[Kemokem deadline] ${redact(e.message)}`));
    }
    return;
  }
  if (!state.encoderContext && !state.busy && !state.encoderStartPending &&
      state.failedEncoderSession !== sessionId && state.finishedEncoderSession !== sessionId) {
    void startEncoder(job);
  } else if (state.encoderContext?.sessionId === sessionId) {
    await api('/live/agent/report', { method: 'POST', body: {
      sessionId, event: 'progress', progress: state.lastProgress, log: state.lastLog,
    }}).catch(() => undefined);
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

// Saved deadlines are reconciled only after an authenticated server job is fetched.
loop();
