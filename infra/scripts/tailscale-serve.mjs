// HTTPS for the tailnet:  pnpm tailscale enable [--port=8443]   |   pnpm tailscale disable [--port=8443]   |   pnpm tailscale status
// Publishes the local Caddy entry point (http://127.0.0.1:HTTP_PORT, default 8080) over HTTPS to YOUR TAILNET ONLY
// (`tailscale serve`, never `funnel`). It uses its own HTTPS port (default 8443) so it never replaces a mapping you
// already have, for example another app on 443. LAN access over plain http://<pc-ip>:8080 keeps working.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { parseArgs, readEnvFile } from './lib.mjs';

const { flags, rest } = parseArgs(process.argv.slice(2));
const action = rest[0] ?? 'status';
const port = Number(flags.port ?? 8443);
const httpPort = Number(readEnvFile().HTTP_PORT || 8080);

const candidates = [
  process.env.TAILSCALE_BIN,
  'tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  '/usr/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
].filter(Boolean);
const bin = candidates.find((c) =>
  c.includes('/') || c.includes('\\') ? fs.existsSync(c) : spawnSync(c, ['version']).status === 0,
);
if (!bin) {
  console.error(
    'Tailscale is not installed or not on PATH. Install it from https://tailscale.com/download and sign in.',
  );
  process.exit(1);
}
const ts = (...args) => spawnSync(bin, args, { encoding: 'utf8' });

if (action === 'status') {
  const r = ts('serve', 'status');
  console.log(r.stdout || r.stderr);
  process.exit(0);
}
if (action === 'enable') {
  const st = JSON.parse(ts('status', '--json').stdout || '{}');
  const dns = String(st.Self?.DNSName ?? '').replace(/\.$/, '');
  const current = ts('serve', 'status').stdout;
  if (new RegExp(`:${port}\\b`).test(current) && !/127\.0\.0\.1:${httpPort}/.test(current)) {
    console.error(
      `HTTPS port ${port} is already used for something else on this machine. Pick another with --port=<n>.`,
    );
    process.exit(1);
  }
  const r = ts('serve', '--bg', `--https=${port}`, `http://127.0.0.1:${httpPort}`);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(
      '\nIf this says HTTPS certificates are not enabled, turn them on once in the Tailscale admin console (DNS -> HTTPS Certificates).',
    );
    process.exit(r.status ?? 1);
  }
  const url = `https://${dns}${port === 443 ? '' : `:${port}`}`;
  console.log(`\nCreator OS is now available on your tailnet at ${url}`);
  console.log(
    'Add it to .env so sign-in cookies and CSRF checks accept it, then run `docker compose up -d`:',
  );
  console.log(`  APP_BASE_URL=${url}`);
  console.log(`  ALLOWED_ORIGINS=${url},http://localhost:${httpPort}`);
  process.exit(0);
}
if (action === 'disable') {
  const r = ts('serve', `--https=${port}`, 'off');
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.status ?? 0);
}
console.error('Usage: tailscale-serve.mjs enable|disable|status [--port=8443]');
process.exit(2);
