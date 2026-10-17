// `pnpm dev`: data stores in Docker (published on 127.0.0.1 only), then API + worker + web with hot reload on the host.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });

if (!existsSync(join(root, '.env'))) run('node', ['infra/scripts/init-env.mjs']);

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const base = loadEnv();
const dataDir = resolve(root, base.DATA_DIR || './.data');
mkdirSync(dataDir, { recursive: true });
const env = {
  ...process.env,
  ...base,
  NODE_ENV: 'development',
  DATA_DIR: dataDir,
  API_HOST: '127.0.0.1',
  API_PORT: '4000',
  API_INTERNAL_URL: 'http://127.0.0.1:4000',
  APP_BASE_URL: 'http://localhost:3000',
  ALLOWED_ORIGINS: ['http://localhost:3000', base.ALLOWED_ORIGINS].filter(Boolean).join(','),
  AGENT_LOOPBACK_HOST: '127.0.0.1',
};

console.log('> starting Postgres + Redis (loopback only)');
const up = run('docker', [
  'compose',
  '--profile',
  'dev',
  'up',
  '-d',
  '--wait',
  'db',
  'redis',
  'db-proxy',
  'redis-proxy',
]);
if (up.status !== 0) {
  console.error('Could not start the data stores. Is Docker Desktop running?');
  process.exit(up.status ?? 1);
}
console.log('> applying migrations');
const mig = run('pnpm', ['--filter', '@creatoros/db', 'migrate'], { env });
if (mig.status !== 0) process.exit(mig.status ?? 1);

const procs = [];
function start(name, args) {
  const p = spawn('pnpm', args, { cwd: root, env, shell: process.platform === 'win32' });
  const tag = `[${name}] `;
  const pipe = (stream, out) =>
    stream.on('data', (d) =>
      String(d)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((l) => out.write(tag + l + '\n')),
    );
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => console.log(`${tag}exited (${code})`));
  procs.push(p);
}
start('api', ['--filter', '@creatoros/api', 'dev']);
start('worker', ['--filter', '@creatoros/worker', 'dev']);
start('web', ['--filter', '@creatoros/web', 'dev']);

console.log(
  '\nCreator OS dev: http://localhost:3000   (API http://127.0.0.1:4000/api/docs)\nCtrl+C to stop (Docker data stores keep running).\n',
);
const stop = () => {
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
