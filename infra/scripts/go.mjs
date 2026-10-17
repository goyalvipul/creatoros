// Runs the Go toolchain inside apps/scanner-agent, finding Go even when it is not on PATH (fresh Windows install).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const agentDir = join(root, 'apps', 'scanner-agent');

export function findGo() {
  const probe = spawnSync('go', ['version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (probe.status === 0) return 'go';
  const candidates = [
    'C:\\Program Files\\Go\\bin\\go.exe',
    'C:\\Go\\bin\\go.exe',
    '/usr/local/go/bin/go',
    '/opt/homebrew/bin/go',
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function runGo(args, opts = {}) {
  const go = findGo();
  if (!go) {
    console.error(
      'Go is not installed. Install it with: winget install GoLang.Go  (then open a new terminal)',
    );
    return 127;
  }
  const r = spawnSync(go, args, {
    cwd: agentDir,
    stdio: 'inherit',
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return r.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runGo(process.argv.slice(2)));
}
