/**
 * Capacity check (spec section 13: 10,000 - 100,000 indexed file instances).
 *
 * Skipped unless CAPACITY_FILES is set, so the normal suite stays fast:
 *
 *   $env:CAPACITY_FILES = "50000"; pnpm --filter @creatoros/tests-integration exec vitest run test/capacity.test.ts
 *
 * It ingests that many synthetic files through the real ingest path (in agent-sized batches), then times the library
 * list, search, counts and global search against the resulting data. Timings are printed, never invented; the assertions
 * are generous ceilings (override with CAPACITY_MAX_MS) that catch an accidental full-table scan or N+1.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '@creatoros/db';
import { libraryCounts, listLibrary, processIngest, search, type AuthedAgent } from '@creatoros/services';
import { makeOrg, makeRoot, openDb, pairTestDevice } from '../src/helpers';

const N = Number(process.env.CAPACITY_FILES ?? 0);
const MAX_MS = Number(process.env.CAPACITY_MAX_MS ?? 1500);
const BATCH = 500;

let h: DbHandle;
beforeAll(() => {
  h = openDb();
});
afterAll(async () => {
  await h.close();
});

const time = async <T>(label: string, fn: () => Promise<T>, report: Record<string, string>) => {
  const t0 = performance.now();
  const out = await fn();
  const ms = performance.now() - t0;
  report[label] = `${ms.toFixed(0)} ms`;
  return { out, ms };
};

describe.skipIf(!N)('capacity', () => {
  it(`indexes ${N} files and keeps the library responsive`, async () => {
    const org = await makeOrg(h);
    const dev = await pairTestDevice(org.ctx);
    const root = await makeRoot(org.ctx, dev.deviceId, 'D:\\Media');
    const agent = (await dev.authFor('{}')) as AuthedAgent;
    const report: Record<string, string> = {};
    const kinds = ['mp4', 'mov', 'wav', 'png', 'jpg'];
    const runId = randomUUID();

    const ingest = await time(
      `ingest ${N} files`,
      async () => {
        for (let i = 0; i < N; i += BATCH) {
          const observations = Array.from({ length: Math.min(BATCH, N - i) }, (_, k) => {
            const n = i + k;
            const path = `D:\\Media\\project-${n % 200}\\clip-${n}.${kinds[n % kinds.length]}`;
            return {
              eventId: `${runId}:${n}`,
              seq: n,
              kind: 'file' as const,
              path,
              size: 1_000_000 + n,
              mtimeMs: 1_700_000_000_000 + n,
              fileId: `id:${n}`,
              state: 'STABLE' as const,
              stableObservations: 2,
              quickSignature: `q:${n}`,
            };
          });
          await processIngest(h.db, org.env, agent, {
            rootId: root.id,
            runId,
            phase: i === 0 ? 'START' : 'PROGRESS',
            observations,
          });
        }
        await processIngest(h.db, org.env, agent, {
          rootId: root.id,
          runId,
          phase: 'END',
          observations: [],
          complete: true,
        });
      },
      report,
    );
    report['ingest rate'] = `${Math.round(N / (ingest.ms / 1000))} files/s`;

    const first = await time('library: first page (50)', () => listLibrary(org.ctx, { limit: 50 }), report);
    expect(first.out.items.length).toBe(50);
    const next = await time(
      'library: second page via cursor',
      () => listLibrary(org.ctx, { limit: 50, cursor: first.out.nextCursor ?? undefined }),
      report,
    );
    const filtered = await time(
      'library: filter kind=VIDEO',
      () => listLibrary(org.ctx, { kind: 'VIDEO', limit: 50 }),
      report,
    );
    const text = await time(
      'library: text search "clip-4242"',
      () => listLibrary(org.ctx, { q: 'clip-4242', limit: 50 }),
      report,
    );
    const counts = await time('library: counts', () => libraryCounts(org.ctx), report);
    const global = await time('global search "project-17"', () => search(org.ctx, 'project-17'), report);

    console.log(`\nCapacity report for ${N} files (${new Date().toISOString()})`);
    console.table(report);

    expect(text.out.items.some((x: any) => /clip-4242/.test(x.fileName ?? x.name ?? ''))).toBe(true);
    expect(counts.out.total).toBe(N);
    for (const t of [first, next, filtered, text, counts, global]) expect(t.ms).toBeLessThan(MAX_MS);
  }, 3_600_000);
});
