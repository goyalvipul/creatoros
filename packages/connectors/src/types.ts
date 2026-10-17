import type { ConnectionState, Provider } from '@creatoros/domain';

export type ConnectorErrorKind =
  | 'NOT_CONFIGURED'
  | 'AUTH_EXPIRED'
  | 'AUTH_REVOKED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'NOT_FOUND'
  | 'CURSOR_EXPIRED'
  | 'CONFLICT'
  | 'UNSUPPORTED'
  | 'BAD_REQUEST'
  | 'NETWORK'
  | 'SERVER';

/** Structured error taxonomy. `retryable` drives backoff in the worker. */
export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly status?: number;
  constructor(kind: ConnectorErrorKind, message: string, opts: { status?: number; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'ConnectorError';
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.retryable = kind === 'RATE_LIMITED' || kind === 'NETWORK' || kind === 'SERVER';
  }
}

export interface Credentials {
  accessToken?: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt?: number;
  apiKey?: string;
  scopes?: string[];
  principal?: string;
  tokenType?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConnectorContext {
  fetch: FetchLike;
  now: () => number;
  credentials: Credentials;
  config: Record<string, any>;
  /** Called whenever tokens were refreshed so the caller can persist them (encrypted). */
  onCredentials?: (c: Credentials) => Promise<void> | void;
  /** Sleep injection so tests do not wait for backoff. */
  sleep?: (ms: number) => Promise<void>;
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
}

export interface ConnectorCapabilities {
  provider: Provider;
  state: ConnectionState;
  read: boolean;
  write: boolean;
  incrementalSync: boolean;
  /** Fine grained flags the UI uses to enable/disable buttons. */
  flags: Record<string, boolean>;
  /** Why something is not possible (approval needed, scope missing…). Shown verbatim to the owner. */
  blockers: string[];
  /** Human steps required before the connector can work. */
  setupSteps: string[];
}

export interface HealthResult {
  ok: boolean;
  state: ConnectionState;
  detail?: string;
  checkedAt: string;
}

export interface SyncResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** True when a full resync was required because the cursor expired. */
  resynced?: boolean;
  stats?: Record<string, number>;
}

export interface RateLimitBudget {
  remaining: number | null;
  limit: number | null;
  resetsAt: string | null;
  estimated: boolean;
}

export interface ConnectResult {
  status: 'REDIRECT' | 'CONNECTED' | 'REQUIRES_APPROVAL' | 'NOT_CONFIGURED';
  authorizeUrl?: string;
  steps?: string[];
  principal?: string;
  /** PKCE material the caller must persist (encrypted) to validate the callback. */
  oauth?: { state: string; verifier: string; scopes: string[] };
}

/** Common interface every integration implements (spec section 8). */
export interface Connector<TNormalized = unknown, TRaw = unknown> {
  readonly id: Provider;
  getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities>;
  connect(ctx: ConnectorContext, input?: Record<string, any>): Promise<ConnectResult>;
  disconnect(ctx: ConnectorContext): Promise<void>;
  refreshCredentials(ctx: ConnectorContext): Promise<Credentials>;
  syncIncremental(ctx: ConnectorContext, cursor: string | null): Promise<SyncResult<TNormalized>>;
  syncFull(ctx: ConnectorContext): Promise<SyncResult<TNormalized>>;
  health(ctx: ConnectorContext): Promise<HealthResult>;
  rateLimitBudget(ctx: ConnectorContext): Promise<RateLimitBudget>;
  normalize(raw: TRaw): TNormalized;
  getExternalRecord(ctx: ConnectorContext, externalId: string): Promise<TNormalized | null>;
}

export interface NormalizedEmail {
  providerMsgId: string;
  providerThreadId: string;
  receivedAt: string;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  subject: string;
  snippet: string;
  bodyText: string | null;
  labelIds: string[];
  direction: 'INBOUND' | 'OUTBOUND';
  attachments: { name: string; mime?: string; sizeBytes?: number; ref?: string }[];
  rawChecksum: string;
  historyId?: string;
}

export interface NormalizedPost {
  provider: Provider;
  externalId: string;
  url: string | null;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  durationMs: number | null;
  privacy: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' | 'SCHEDULED';
  state: 'PUBLISHED_VERIFIED' | 'SCHEDULED' | 'PROCESSING' | 'FAILED' | 'UNKNOWN' | 'REMOVED';
  stats: { views?: number; likes?: number; comments?: number; shares?: number } | null;
  thumbnailUrl: string | null;
  accountExternalId: string | null;
  raw?: unknown;
}
