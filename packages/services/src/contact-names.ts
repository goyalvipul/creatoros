import { eq, providerConnections, sql } from '@creatoros/db';
import {
  fetchFacebookContact,
  fetchInstagramContact,
  readFacebookClientConfig,
  readInstagramClientConfig,
  type ConnectorContext,
} from '@creatoros/connectors';
import { connectorContext } from './integrations';
import type { Ctx } from './types';

const rowsOf = <T>(r: any): T[] => (Array.isArray(r) ? r : (r?.rows ?? [])) as T[];
const MAX_MISSES = 500;

/**
 * Replaces raw numeric sender ids with the person's real name/username where Meta allows it (User Profile API).
 * Read-only. Ids Meta will not resolve are remembered so they are not asked again on every sync.
 */
export async function enrichContactNames(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
  limit = 40,
) {
  const [conn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, connectionId));
  if (!conn || conn.orgId !== ctx.orgId || !['instagram', 'facebook'].includes(conn.provider))
    return { resolved: 0, tried: 0 };
  const cfg = (conn.config ?? {}) as any;
  const missed: string[] = Array.isArray(cfg.social?.nameMiss) ? cfg.social.nameMiss : [];
  const todo = rowsOf<{ id: string; pid: string }>(
    await ctx.db.execute(sql`
      select id, participant_id as pid from conversation_threads
      where provider_connection_id = ${conn.id} and kind = 'DM' and participant_id is not null
        and (participant_name is null or participant_name = participant_id)
        and participant_id not in (select jsonb_array_elements_text(${JSON.stringify(missed)}::jsonb))
      order by last_inbound_at desc nulls last limit ${limit}`),
  );
  if (!todo.length) return { resolved: 0, tried: 0 };
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  const fb =
    conn.provider === 'facebook'
      ? readFacebookClientConfig({ ...ctx.env.processEnv, APP_BASE_URL: ctx.env.appBaseUrl })
      : null;
  const version = readInstagramClientConfig(ctx.env.processEnv)?.graphVersion;
  let resolved = 0;
  const newMisses: string[] = [];
  for (const t of todo) {
    const p =
      conn.provider === 'facebook'
        ? fb
          ? await fetchFacebookContact(cctx, fb, t.pid)
          : null
        : await fetchInstagramContact(cctx, t.pid, version);
    const name = p && ('username' in p && p.username ? p.username : p.name);
    if (!name) {
      newMisses.push(t.pid);
      continue;
    }
    resolved += 1;
    await ctx.db.execute(sql`update conversation_threads set participant_name = ${name} where id = ${t.id}`);
    await ctx.db.execute(
      sql`update messages set from_name = ${name} where thread_id = ${t.id} and direction = 'INBOUND' and (from_name is null or from_name = ${t.pid})`,
    );
  }
  if (newMisses.length) {
    const [fresh] = await ctx.db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, conn.id));
    const c2 = (fresh?.config ?? {}) as any;
    const all = [...(c2.social?.nameMiss ?? []), ...newMisses].slice(-MAX_MISSES);
    await ctx.db
      .update(providerConnections)
      .set({ config: { ...c2, social: { ...(c2.social ?? {}), nameMiss: all } } })
      .where(eq(providerConnections.id, conn.id));
  }
  return { resolved, tried: todo.length };
}
