import { and, eq, fxRates, sql } from '@creatoros/db';
import type { Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Live mid-market rate `from` -> `to`. Tries Frankfurter (ECB), then open.er-api.com. No API key; null when both fail. */
export async function fetchLiveRate(
  from: string,
  to: string,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<{ rate: number; source: string } | null> {
  const attempts: [string, string, (j: any) => unknown][] = [
    [
      `https://api.frankfurter.app/latest?from=${from}&to=${to}`,
      'live:frankfurter',
      (j) => j?.rates?.[to],
    ],
    [`https://open.er-api.com/v6/latest/${from}`, 'live:open.er-api', (j) => j?.rates?.[to]],
  ];
  for (const [url, source, pick] of attempts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    try {
      const res = await fetchImpl(url, { signal: ac.signal });
      if (!res.ok) continue;
      const rate = Number(pick(await res.json()));
      if (Number.isFinite(rate) && rate > 0) return { rate, source };
    } catch {
      /* try the next source */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Keeps one live rate per foreign currency (to the organisation's base currency) in `fx_rates`, refreshed when older than
 * `maxAgeMs`. A failed lookup leaves the previous rate (or the missing-rate notice) in place; nothing is ever invented.
 */
export async function ensureLiveRates(
  ctx: Ctx,
  overrides: { fetch?: FetchLike } = {},
  opts: { maxAgeMs?: number; force?: boolean } = {},
) {
  const maxAge = opts.maxAgeMs ?? 60 * 60_000;
  const base =
    rowsOf<{ b: string }>(
      await ctx.db.execute(sql`select base_currency as b from organizations where id = ${ctx.orgId}`),
    )[0]?.b ?? 'CAD';
  const cur = rowsOf<{ c: string }>(
    await ctx.db.execute(sql`
      select distinct currency as c from invoices where org_id = ${ctx.orgId} and status <> 'VOID'
      union select distinct currency from payments where org_id = ${ctx.orgId}
      union select distinct currency from expenses where org_id = ${ctx.orgId}`),
  )
    .map((r) => r.c)
    .filter((c) => c !== base);
  const updated: string[] = [];
  const failed: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const c of cur) {
    const [last] = await ctx.db
      .select()
      .from(fxRates)
      .where(and(eq(fxRates.orgId, ctx.orgId), eq(fxRates.baseCurrency, c), eq(fxRates.quoteCurrency, base)))
      .orderBy(sql`${fxRates.rateDate} desc, ${fxRates.createdAt} desc`)
      .limit(1);
    if (
      !opts.force &&
      last?.source.startsWith('live') &&
      Date.now() - last.createdAt.getTime() < maxAge
    )
      continue;
    const live = await fetchLiveRate(c, base, overrides.fetch);
    if (!live) {
      failed.push(c);
      continue;
    }
    await ctx.db
      .insert(fxRates)
      .values({
        orgId: ctx.orgId,
        baseCurrency: c,
        quoteCurrency: base,
        rate: String(live.rate),
        rateDate: today,
        source: live.source,
      })
      .onConflictDoUpdate({
        target: [fxRates.orgId, fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.rateDate],
        set: { rate: String(live.rate), source: live.source, createdAt: new Date() },
      });
    updated.push(c);
  }
  return { base, updated, failed };
}
