/**
 * Generates the fixture library used by the real-agent tests:  tsx tests/fixtures/generate.ts [targetDir]
 * Everything is synthetic (ffmpeg test patterns) and lives outside the repository's tracked files. It is data for
 * automated tests only; it is never presented as the owner's real content.
 *
 * Layout and what each file is for
 *   video/final cut.mp4                      2 s test video with audio          (probe: duration, size, codecs)
 *   video/copy of final cut.mp4              exact duplicate, different name    (same media object, two locations)
 *   archive/Été à Paris/clip 日本語.mp4        exact duplicate, Unicode + spaces  (path fidelity)
 *   video/final cut (re-encode).mp4          similar content, different bytes   (NOT an exact duplicate)
 *   video/take.mp4  +  archive/take.mp4      same filename, different content   (stay distinct)
 *   video/truncated.mp4                      cut off mid-file                   (probe fails, file still indexed)
 *   audio/song.wav  +  audio/.hidden-song.wav  hidden dot-file duplicate        (indexed, same media object)
 *   images/cover.png                         still image                        (probed without ffprobe)
 *   docs/readme.txt                          not media                          (filtered by extension)
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const FIXTURE_EXTENSIONS = ['mp4', 'wav', 'png'];

export function findFfmpeg(): string | null {
  const r = spawnSync('ffmpeg', ['-version'], { shell: process.platform === 'win32' });
  return r.status === 0 ? 'ffmpeg' : null;
}

function ff(ffmpeg: string, args: string[]) {
  const r = spawnSync(ffmpeg, ['-y', '-v', 'error', ...args], { encoding: 'utf8', shell: false });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed: ${r.stderr}`);
}

export function generateFixtureLibrary(root: string, ffmpeg: string) {
  rmSync(root, { recursive: true, force: true });
  const p = (...parts: string[]) => path.join(root, ...parts);
  for (const d of ['video', 'audio', 'images', 'docs', path.join('archive', 'Été à Paris')])
    mkdirSync(p(d), { recursive: true });

  const finalCut = p('video', 'final cut.mp4');
  ff(ffmpeg, [
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', finalCut,
  ]);
  copyFileSync(finalCut, p('video', 'copy of final cut.mp4'));
  copyFileSync(finalCut, p('archive', 'Été à Paris', 'clip 日本語.mp4'));
  ff(ffmpeg, ['-i', finalCut, '-c:v', 'libx264', '-crf', '38', '-c:a', 'aac', '-b:a', '48k', p('video', 'final cut (re-encode).mp4')]);

  ff(ffmpeg, ['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('video', 'take.mp4')]);
  ff(ffmpeg, ['-f', 'lavfi', '-i', 'smptebars=size=160x120:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('archive', 'take.mp4')]);

  const whole = readFileSync(finalCut);
  writeFileSync(p('video', 'truncated.mp4'), whole.subarray(0, Math.floor(whole.length * 0.35)));

  ff(ffmpeg, ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.5', p('audio', 'song.wav')]);
  copyFileSync(p('audio', 'song.wav'), p('audio', '.hidden-song.wav'));
  ff(ffmpeg, ['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=1:duration=1', '-frames:v', '1', p('images', 'cover.png')]);
  writeFileSync(p('docs', 'readme.txt'), 'not media');

  // Everything the agent should treat as settled is an hour old (the "growing file" case is created by the test itself).
  const old = new Date(Date.now() - 3_600_000);
  for (const f of [
    ['video', 'final cut.mp4'],
    ['video', 'copy of final cut.mp4'],
    ['archive', 'Été à Paris', 'clip 日本語.mp4'],
    ['video', 'final cut (re-encode).mp4'],
    ['video', 'take.mp4'],
    ['archive', 'take.mp4'],
    ['video', 'truncated.mp4'],
    ['audio', 'song.wav'],
    ['audio', '.hidden-song.wav'],
    ['images', 'cover.png'],
    ['docs', 'readme.txt'],
  ])
    utimesSync(p(...f), old, old);
  return { finalCut };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    console.error('ffmpeg is not installed; cannot generate the fixture library.');
    process.exit(1);
  }
  const target = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, 'library'));
  generateFixtureLibrary(target, ffmpeg);
  console.log(`Fixture library written to ${target}`);
}
