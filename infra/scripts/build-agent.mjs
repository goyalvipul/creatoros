// Builds the scanner agent binaries into apps/scanner-agent/dist.
//   node infra/scripts/build-agent.mjs            -> windows/amd64 + current platform
//   node infra/scripts/build-agent.mjs --all      -> also linux/amd64, linux/arm64, darwin/arm64
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentDir, runGo } from './go.mjs';

const all = process.argv.includes('--all');
const pkg = JSON.parse(readFileSync(join(agentDir, 'package.json'), 'utf8'));
const version = pkg.version ?? '0.1.0';
const dist = join(agentDir, 'dist');
mkdirSync(dist, { recursive: true });

const targets = [{ goos: 'windows', goarch: 'amd64' }];
if (all)
  targets.push(
    { goos: 'linux', goarch: 'amd64' },
    { goos: 'linux', goarch: 'arm64' },
    { goos: 'darwin', goarch: 'arm64' },
  );

let failed = 0;
for (const t of targets) {
  const out = join(dist, `creatoros-agent-${t.goos}-${t.goarch}${t.goos === 'windows' ? '.exe' : ''}`);
  console.log(`building ${out}`);
  const code = runGo(
    [
      'build',
      '-trimpath',
      '-ldflags',
      `-s -w -X main.version=${version}`,
      '-o',
      out,
      './cmd/creatoros-agent',
    ],
    {
      env: { GOOS: t.goos, GOARCH: t.goarch, CGO_ENABLED: '0' },
    },
  );
  if (code !== 0) failed += 1;
}
process.exit(failed ? 1 : 0);
