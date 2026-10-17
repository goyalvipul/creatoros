// Shared helpers for the operator scripts (backup, restore, diagnostics). Plain Node, no dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '../..');

export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    } else rest.push(a);
  }
  return { flags, rest };
}

/** Run `docker compose <args>` and collect text output. */
export function compose(args, opts = {}) {
  const r = spawnSync('docker', ['compose', ...args], {
    cwd: root,
    encoding: 'utf8',
    input: opts.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`Could not run docker: ${r.error.message}. Is Docker Desktop running?`);
  if (r.status !== 0 && !opts.allowFail)
    throw new Error(
      `docker compose ${args.join(' ')} failed (${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 600)}`,
    );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Stream `docker compose <args>` stdout into a file (binary safe). */
export function composeToFile(args, file) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = fs.createWriteStream(file);
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.stdout.pipe(out);
    child.on('error', reject);
    child.on(
      'close',
      (code) => (
        out.close(),
        code === 0
          ? resolve()
          : reject(
              new Error(`docker compose ${args.join(' ')} failed (${code}): ${err.trim().slice(0, 600)}`),
            )
      ),
    );
  });
}

/** Stream a file into `docker compose <args>` stdin. */
export function fileToCompose(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`docker compose ${args.join(' ')} failed (${code}): ${err.trim().slice(0, 800)}`)),
    );
    fs.createReadStream(file).on('error', reject).pipe(child.stdin);
  });
}

export function sha256File(file) {
  const h = createHash('sha256');
  return new Promise((resolve, reject) =>
    fs
      .createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject),
  );
}

export function readEnvFile() {
  const env = {};
  const f = path.join(root, '.env');
  if (!fs.existsSync(f)) return env;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

export const dbCreds = () => {
  const e = readEnvFile();
  return { user: e.POSTGRES_USER || 'creatoros', db: e.POSTGRES_DB || 'creatoros' };
};

export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
