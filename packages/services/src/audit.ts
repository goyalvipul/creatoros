import { auditEvents, outboxEvents, type Executor } from '@creatoros/db';
import { EVENT_VERSION, type EventType } from '@creatoros/domain';
import { redact } from './crypto';
import type { Ctx } from './types';

export async function audit(
  ctx: Pick<Ctx, 'db' | 'orgId' | 'actor' | 'userId' | 'correlationId' | 'ip'> & { db: Executor },
  action: string,
  object?: { type: string; id?: string | null },
  before?: unknown,
  after?: unknown,
): Promise<void> {
  await ctx.db.insert(auditEvents).values({
    orgId: ctx.orgId,
    actorUserId: ctx.actor.type === 'user' ? (ctx.userId ?? ctx.actor.id ?? null) : null,
    actorType: ctx.actor.type,
    action,
    objectType: object?.type ?? null,
    objectId: object?.id ?? null,
    before: before === undefined ? null : (redact(before) as Record<string, unknown>),
    after: after === undefined ? null : (redact(after) as Record<string, unknown>),
    correlationId: ctx.correlationId ?? null,
    ip: ctx.ip ?? null,
  });
}

/** Transactional outbox: call inside the same transaction that changes state. */
export async function emit(
  db: Executor,
  orgId: string,
  type: EventType,
  data: Record<string, unknown>,
): Promise<void> {
  await db.insert(outboxEvents).values({ orgId, type, version: EVENT_VERSION, payload: data });
}
