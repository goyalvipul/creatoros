import { createHash } from 'node:crypto';
import {
  ConnectorError,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorContext,
  type ConnectResult,
  type Credentials,
  type HealthResult,
  type NormalizedEmail,
  type RateLimitBudget,
  type SyncResult,
} from '../types';
import { ensureFreshToken, http } from '../http';
import {
  buildGoogleAuthUrl,
  GOOGLE_SCOPES,
  hasScope,
  refreshGoogleToken,
  revokeGoogleToken,
  type GoogleClientConfig,
} from './oauth';
import { generatePkce, randomState } from '../pkce';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
}
export interface GmailRawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPart;
}

/** Split `"Name" <addr@x.com>` into the real address and display name; never trust the display name as identity. */
export function parseAddress(raw: string | undefined | null): { email: string | null; name: string | null } {
  if (!raw) return { email: null, name: null };
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(raw);
  if (m) return { email: m[2].trim().toLowerCase(), name: (m[1] ?? '').trim() || null };
  const bare = raw.trim();
  return /@/.test(bare) ? { email: bare.toLowerCase(), name: null } : { email: null, name: bare || null };
}

function header(msg: GmailRawMessage, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Gmail snippets and HTML parts carry entities such as &#39; and &amp;; store readable text. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function decodeB64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function extractText(part: GmailPart | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeB64Url(part.body.data);
  for (const p of part.parts ?? []) {
    const t = extractText(p);
    if (t) return t;
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeEntities(
      decodeB64Url(part.body.data)
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<(?:br|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{3,}/g, '\n\n'),
    ).trim();
  }
  return null;
}

function collectAttachments(
  part: GmailPart | undefined,
  out: NormalizedEmail['attachments'] = [],
): NormalizedEmail['attachments'] {
  if (!part) return out;
  if (part.filename)
    out.push({
      name: part.filename,
      mime: part.mimeType,
      sizeBytes: part.body?.size,
      ref: part.body?.attachmentId,
    });
  for (const p of part.parts ?? []) collectAttachments(p, out);
  return out;
}

export class GmailConnector implements Connector<NormalizedEmail, GmailRawMessage> {
  readonly id = 'gmail' as const;

  async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const client = ctx.config.googleClient as GoogleClientConfig | undefined;
    const creds = ctx.credentials;
    const hasTokens = Boolean(creds.refreshToken || creds.accessToken);
    const read = hasTokens && hasScope(creds, GOOGLE_SCOPES.gmailRead[0]);
    const drafts = hasTokens && hasScope(creds, GOOGLE_SCOPES.gmailDrafts[0]);
    const send = hasTokens && hasScope(creds, GOOGLE_SCOPES.gmailSend[0]);
    const blockers: string[] = [];
    if (!client)
      blockers.push(
        'Google OAuth client is not configured (set GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI and optionally GOOGLE_CLIENT_SECRET).',
      );
    if (client && !hasTokens)
      blockers.push('Gmail account not connected yet. Use the Connect button and approve read-only access.');
    return {
      provider: 'gmail',
      state: !client ? 'NOT_CONFIGURED' : !hasTokens ? 'NOT_CONFIGURED' : 'ACTIVE',
      read,
      write: send,
      incrementalSync: read,
      flags: {
        readMessages: read,
        createDrafts: drafts,
        sendEmail: send,
        pushNotifications: Boolean(ctx.config.pubsubTopic),
      },
      blockers,
      setupSteps: [
        'Create an OAuth client in Google Cloud Console (Desktop or Web application) and enable the Gmail API.',
        'Add the redirect URI shown in Integrations to the client, then set GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI (and GOOGLE_CLIENT_SECRET for Web clients) in .env.',
        'Press Connect in Integrations and approve gmail.readonly. Creator OS never sends email; drafts require the separate gmail.compose scope.',
      ],
    };
  }

  async connect(ctx: ConnectorContext, input: Record<string, any> = {}): Promise<ConnectResult> {
    const client = ctx.config.googleClient as GoogleClientConfig | undefined;
    if (!client) return { status: 'NOT_CONFIGURED', steps: (await this.getCapabilities(ctx)).setupSteps };
    const pkce = generatePkce();
    const state = randomState();
    const scopes = [
      ...GOOGLE_SCOPES.identity,
      ...GOOGLE_SCOPES.gmailRead,
      ...(input.drafts ? GOOGLE_SCOPES.gmailDrafts : []),
      ...(input.send ? GOOGLE_SCOPES.gmailSend : []),
    ];
    return {
      status: 'REDIRECT',
      authorizeUrl: buildGoogleAuthUrl({
        client,
        scopes,
        state,
        codeChallenge: pkce.challenge,
        loginHint: input.loginHint,
      }),
      oauth: { state, verifier: pkce.verifier, scopes },
    };
  }

  async disconnect(ctx: ConnectorContext): Promise<void> {
    await revokeGoogleToken(ctx);
  }

  refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    return refreshGoogleToken(ctx);
  }

  private async token(ctx: ConnectorContext): Promise<string> {
    return ensureFreshToken(ctx, refreshGoogleToken);
  }

  private async get<T>(
    ctx: ConnectorContext,
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const token = await this.token(ctx);
    const { data } = await http<T>(ctx, `${API}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      query,
    });
    return data;
  }

  /** Headers of one message: reply threading ids plus who it was addressed to (for Reply and Reply all). */
  async getReplyHeaders(
    ctx: ConnectorContext,
    messageId: string,
  ): Promise<{
    messageId: string | null;
    references: string | null;
    replyTo: string | null;
    from: string | null;
    to: string | null;
    cc: string | null;
  }> {
    const raw = await this.get<GmailRawMessage>(
      ctx,
      `/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Reply-To&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
    );
    return {
      messageId: header(raw, 'Message-ID') ?? null,
      references: header(raw, 'References') ?? null,
      replyTo: header(raw, 'Reply-To') ?? null,
      from: header(raw, 'From') ?? null,
      to: header(raw, 'To') ?? null,
      cc: header(raw, 'Cc') ?? null,
    };
  }

  /**
   * Sends one plain-text email in an existing Gmail thread. Requires gmail.send. POST is never auto-retried by the HTTP layer,
   * so a network failure surfaces as an error the caller must treat as UNCERTAIN (the mail may or may not have gone out).
   */
  async sendEmail(
    ctx: ConnectorContext,
    input: {
      to: string[];
      cc?: string[];
      subject: string;
      body: string;
      threadId?: string;
      inReplyTo?: string | null;
      references?: string | null;
    },
  ): Promise<{ id: string; threadId: string }> {
    if (!hasScope(ctx.credentials, GOOGLE_SCOPES.gmailSend[0]))
      throw new ConnectorError(
        'PERMISSION_DENIED',
        'Gmail send permission is not granted. Reconnect Gmail and allow sending.',
      );
    const clean = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();
    const lines = [
      `To: ${input.to.map(clean).join(', ')}`,
      ...(input.cc?.length ? [`Cc: ${input.cc.map(clean).join(', ')}`] : []),
      `Subject: =?UTF-8?B?${Buffer.from(clean(input.subject), 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      ...(input.inReplyTo ? [`In-Reply-To: ${clean(input.inReplyTo)}`] : []),
      ...(input.references || input.inReplyTo
        ? [`References: ${clean([input.references, input.inReplyTo].filter(Boolean).join(' '))}`]
        : []),
    ];
    const b64 = Buffer.from(input.body, 'utf8')
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n');
    const raw = Buffer.from(`${lines.join('\r\n')}\r\n\r\n${b64}`, 'utf8').toString('base64url');
    const token = await this.token(ctx);
    const { data } = await http<{ id: string; threadId: string }>(ctx, `${API}/messages/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      json: input.threadId ? { raw, threadId: input.threadId } : { raw },
      maxAttempts: 1,
    });
    return data;
  }

  async health(ctx: ConnectorContext): Promise<HealthResult> {
    try {
      await this.get(ctx, '/profile');
      return { ok: true, state: 'ACTIVE', checkedAt: new Date(ctx.now()).toISOString() };
    } catch (e) {
      const err = e as ConnectorError;
      const state =
        err.kind === 'AUTH_REVOKED' || err.kind === 'AUTH_EXPIRED'
          ? 'AUTH_EXPIRED'
          : err.kind === 'NOT_CONFIGURED'
            ? 'NOT_CONFIGURED'
            : 'ERROR';
      return { ok: false, state, detail: err.message, checkedAt: new Date(ctx.now()).toISOString() };
    }
  }

  async rateLimitBudget(): Promise<RateLimitBudget> {
    // Gmail quota is 250 units/user/second; we do not get live remaining counts.
    return { remaining: null, limit: 250, resetsAt: null, estimated: true };
  }

  normalize(raw: GmailRawMessage): NormalizedEmail {
    const from = parseAddress(header(raw, 'From'));
    const to = (header(raw, 'To') ?? '')
      .split(',')
      .map((s) => parseAddress(s).email)
      .filter((x): x is string => !!x);
    const labels = raw.labelIds ?? [];
    const outbound = labels.includes('SENT') || labels.includes('DRAFT');
    const subject = header(raw, 'Subject') ?? '';
    const ts = raw.internalDate
      ? new Date(Number(raw.internalDate)).toISOString()
      : new Date(header(raw, 'Date') ?? Date.now()).toISOString();
    const body = extractText(raw.payload);
    return {
      providerMsgId: raw.id,
      providerThreadId: raw.threadId,
      receivedAt: ts,
      fromEmail: from.email,
      fromName: from.name,
      toEmails: to,
      subject,
      snippet: decodeEntities(raw.snippet ?? ''),
      bodyText: body,
      labelIds: labels,
      direction: outbound ? 'OUTBOUND' : 'INBOUND',
      attachments: collectAttachments(raw.payload),
      rawChecksum: createHash('sha256')
        .update(`${raw.id}|${subject}|${raw.snippet ?? ''}|${ts}`)
        .digest('hex'),
      historyId: raw.historyId,
    };
  }

  async getExternalRecord(ctx: ConnectorContext, id: string): Promise<NormalizedEmail | null> {
    try {
      const raw = await this.get<GmailRawMessage>(ctx, `/messages/${encodeURIComponent(id)}`, {
        format: 'full',
      });
      return this.normalize(raw);
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'NOT_FOUND') return null;
      throw e;
    }
  }

  private async fetchMetadata(ctx: ConnectorContext, id: string): Promise<GmailRawMessage | null> {
    try {
      const token = await this.token(ctx);
      const { data } = await http<GmailRawMessage>(ctx, `${API}/messages/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${token}` },
        query: { format: 'metadata' },
      });
      return data;
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'NOT_FOUND') return null; // deleted between list and get
      throw e;
    }
  }

  /** Message ids matching a Gmail search (id and threadId only: one cheap call per 100 results). */
  async searchIds(
    ctx: ConnectorContext,
    opts: { query: string; max?: number },
  ): Promise<{ id: string; threadId: string }[]> {
    const out: { id: string; threadId: string }[] = [];
    const max = opts.max ?? 500;
    let pageToken: string | undefined;
    do {
      const list = await this.get<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(
        ctx,
        '/messages',
        { maxResults: 100, pageToken, q: opts.query },
      );
      for (const m of list.messages ?? []) if (out.length < max) out.push(m);
      pageToken = out.length >= max ? undefined : list.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** One message with its full body and attachment names (needed to read invoice text; the normal sync stores metadata + snippet). */
  async getFullMessage(ctx: ConnectorContext, id: string): Promise<NormalizedEmail | null> {
    try {
      const raw = await this.get<GmailRawMessage>(ctx, `/messages/${encodeURIComponent(id)}`, {
        format: 'full',
      });
      return this.normalize(raw);
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'NOT_FOUND') return null;
      throw e;
    }
  }

  /** Full sync: capture historyId FIRST so nothing arriving during the listing is missed. */
  async syncFull(
    ctx: ConnectorContext,
    opts: { maxMessages?: number; query?: string } = {},
  ): Promise<SyncResult<NormalizedEmail>> {
    const profile = await this.get<{ historyId: string; emailAddress: string }>(ctx, '/profile');
    const items: NormalizedEmail[] = [];
    let pageToken: string | undefined;
    const max = opts.maxMessages ?? 500;
    do {
      const list = await this.get<{ messages?: { id: string }[]; nextPageToken?: string }>(ctx, '/messages', {
        maxResults: 100,
        pageToken,
        q: opts.query ?? 'newer_than:90d -in:chats -category:promotions',
      });
      for (const m of list.messages ?? []) {
        if (items.length >= max) break;
        const raw = await this.fetchMetadata(ctx, m.id);
        if (raw) items.push(this.normalize(raw));
      }
      pageToken = items.length >= max ? undefined : list.nextPageToken;
    } while (pageToken);
    return { items, nextCursor: profile.historyId, hasMore: false, stats: { messages: items.length } };
  }

  /** Incremental sync with history.list. A 404 means the cursor expired -> caller (or this method) falls back to full resync. */
  async syncIncremental(ctx: ConnectorContext, cursor: string | null): Promise<SyncResult<NormalizedEmail>> {
    if (!cursor) return this.syncFull(ctx);
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let latest = cursor;
    try {
      do {
        const res = await this.get<{
          history?: { id: string; messagesAdded?: { message: { id: string } }[] }[];
          historyId?: string;
          nextPageToken?: string;
        }>(ctx, '/history', {
          startHistoryId: cursor,
          historyTypes: 'messageAdded',
          maxResults: 100,
          pageToken,
        });
        for (const h of res.history ?? []) {
          for (const a of h.messagesAdded ?? []) ids.add(a.message.id);
          if (h.id) latest = h.id;
        }
        if (res.historyId) latest = res.historyId;
        pageToken = res.nextPageToken;
      } while (pageToken);
      // Starring an older message adds a label, not a message: pick those up too so the Starred tab stays current.
      let labelPage: string | undefined;
      do {
        const res = await this.get<{
          history?: { labelsAdded?: { message: { id: string }; labelIds?: string[] }[] }[];
          nextPageToken?: string;
        }>(ctx, '/history', {
          startHistoryId: cursor,
          historyTypes: 'labelAdded',
          maxResults: 100,
          pageToken: labelPage,
        });
        for (const h of res.history ?? [])
          for (const a of h.labelsAdded ?? []) if (a.labelIds?.includes('STARRED')) ids.add(a.message.id);
        labelPage = res.nextPageToken;
      } while (labelPage);
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'NOT_FOUND') {
        const full = await this.syncFull(ctx);
        return { ...full, resynced: true };
      }
      throw e;
    }
    const items: NormalizedEmail[] = [];
    for (const id of ids) {
      const raw = await this.fetchMetadata(ctx, id);
      if (raw) items.push(this.normalize(raw));
    }
    return { items, nextCursor: latest, hasMore: false, stats: { messages: items.length } };
  }
}
