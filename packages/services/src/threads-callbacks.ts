import { randomBytes } from 'node:crypto';
import { and, auditEvents, eq, providerConnections, publicationRecords, socialAccounts, syncCursors } from '@creatoros/db';
import { parseThreadsSignedRequest, readThreadsClientConfig } from '@creatoros/connectors';
import type { Db } from '@creatoros/db';
import type { ServiceEnv } from './types';

function secretOf(env: ServiceEnv) {
  return readThreadsClientConfig(env.processEnv, env.appBaseUrl)?.appSecret ?? '';
}

async function connectionsFor(db: Db, userId: string) {
  return db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.provider, 'threads'), eq(providerConnections.principalHint, userId)));
}

/** Threads uninstall callback. Drops the token and leaves imported posts in place. */
export async function deauthorizeThreads(db: Db, env: ServiceEnv, signedRequest: string) {
  const secret = secretOf(env);
  if (!secret) return { configured: false as const };
  const parsed = parseThreadsSignedRequest(signedRequest, secret);
  if (!parsed) return { configured: true as const, valid: false as const };
  const rows = await connectionsFor(db, parsed.userId);
  for (const conn of rows) {
    await db.delete(syncCursors).where(eq(syncCursors.connectionId, conn.id));
    await db
      .update(providerConnections)
      .set({
        encryptedTokenRef: null,
        scopes: [],
        state: 'AUTH_EXPIRED',
        lastError: 'Threads access was removed in Threads.',
        updatedAt: new Date(),
      })
      .where(eq(providerConnections.id, conn.id));
    await db.insert(auditEvents).values({
      orgId: conn.orgId,
      actorType: 'system',
      action: 'threads.deauthorized',
      objectType: 'provider_connection',
      objectId: conn.id,
      after: { provider: 'threads' },
    });
  }
  return { configured: true as const, valid: true as const, connections: rows.length };
}

/**
 * Threads data-deletion callback. Removes the token and imported Threads posts for that login.
 * The confirmation page does not show the Threads user id.
 */
export async function deleteThreadsData(db: Db, env: ServiceEnv, signedRequest: string) {
  const secret = secretOf(env);
  if (!secret) return { configured: false as const };
  const parsed = parseThreadsSignedRequest(signedRequest, secret);
  if (!parsed) return { configured: true as const, valid: false as const };
  const code = randomBytes(9).toString('base64url');
  const rows = await connectionsFor(db, parsed.userId);
  let removedPosts = 0;
  for (const conn of rows) {
    const accounts = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(eq(socialAccounts.providerConnectionId, conn.id));
    for (const account of accounts) {
      const removed = await db
        .delete(publicationRecords)
        .where(
          and(
            eq(publicationRecords.orgId, conn.orgId),
            eq(publicationRecords.socialAccountId, account.id),
            eq(publicationRecords.provider, 'threads'),
          ),
        )
        .returning({ id: publicationRecords.id });
      removedPosts += removed.length;
      await db
        .update(socialAccounts)
        .set({
          externalAccountId: null,
          profileUrl: null,
          verifiedLink: false,
          providerConnectionId: null,
          updatedAt: new Date(),
        })
        .where(eq(socialAccounts.id, account.id));
    }
    await db.delete(syncCursors).where(eq(syncCursors.connectionId, conn.id));
    await db.delete(providerConnections).where(eq(providerConnections.id, conn.id));
  }
  await db.insert(auditEvents).values({
    orgId: rows[0]?.orgId ?? null,
    actorType: 'system',
    action: 'threads.data_deleted',
    objectType: 'data_deletion',
    objectId: code,
    after: { status: 'COMPLETED', provider: 'threads', connections: rows.length, posts: removedPosts },
  });
  const base = env.appBaseUrl.replace(/\/$/, '');
  return {
    configured: true as const,
    valid: true as const,
    body: {
      url: `${base}/api/v1/integrations/threads/data-deletion?code=${code}`,
      confirmation_code: code,
    },
  };
}

export async function threadsDeletionStatus(db: Db, code: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return null;
  const [row] = await db
    .select({ after: auditEvents.after })
    .from(auditEvents)
    .where(and(eq(auditEvents.objectType, 'data_deletion'), eq(auditEvents.objectId, code), eq(auditEvents.action, 'threads.data_deleted')))
    .limit(1);
  if (!row) return null;
  return { status: 'COMPLETED' as const };
}
