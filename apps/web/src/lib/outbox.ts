'use client';

import { useEffect, useState } from 'react';

const STORE = 'cos-outbox';
const ID_MAP = 'cos-outbox-ids';
const MAX_ITEMS = 50;

/**
 * Creates and edits can wait on the phone. Anything that sends, pays, renders,
 * deletes a file, or turns a workflow on cannot: those stay on the server and
 * fail honestly while offline.
 */
const REFUSE =
  /\/(generate|publish|mark-published|payments|reply|send|activate|simulate|rollback|operations|check|validate|pause-all|backup|restore|scan|sync|trends)(\/|$)/;

export type OutboxItem = {
  id: string;
  method: 'POST' | 'PATCH' | 'PUT';
  path: string;
  body: unknown;
  idempotencyKey: string;
  createdAt: string;
  label: string;
  localId?: string;
  error?: string;
  view?: WorkflowView;
};

export type WorkflowView = {
  id: string;
  name: string;
  description: string | null;
  mode: string;
  status: 'DRAFT';
  connectionIds: string[];
  latestVersion: number;
  testedVersion: null;
  pendingSync: true;
  updatedAt: string;
  runs24h: number;
  pendingApprovals: number;
  pauseReason: null;
  definition: unknown;
  versions: { version: number; createdAt: string; mode: string }[];
};

export type QueueRequest = {
  method: 'POST' | 'PATCH' | 'PUT';
  path: string;
  body: unknown;
  now: string;
  id: string;
  idempotencyKey: string;
  localId?: string;
};

type Status = { syncing: boolean; note: string | null };

const listeners = new Set<() => void>();
let status: Status = { syncing: false, note: null };
let sendingId: string | null = null;
let running: Promise<void> | null = null;
let afterSync: (path: string) => void = () => {};

export function onOutboxSynced(fn: (path: string) => void) {
  afterSync = fn;
}

export function queueable(method: string, path: string): boolean {
  if (method !== 'POST' && method !== 'PATCH' && method !== 'PUT') return false;
  const bare = path.split('?')[0] ?? path;
  if (bare.startsWith('/auth')) return false;
  if (bare.includes('/local-') && method === 'POST') return false;
  return !REFUSE.test(bare);
}

export function isLocalId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('local-');
}

function localIdIn(path: string): string | null {
  const hit = path.match(/local-[0-9a-f-]{36}/i);
  return hit ? hit[0] : null;
}

export function rewritePath(path: string, map: Record<string, string>): string {
  let out = path;
  for (const [local, real] of Object.entries(map)) out = out.split(local).join(real);
  return out;
}

function workflowView(body: Record<string, unknown>, id: string, at: string): WorkflowView {
  const mode = typeof body.mode === 'string' ? body.mode : 'DRAFT_ONLY';
  return {
    id,
    name: typeof body.name === 'string' && body.name.trim() ? body.name : 'My workflow',
    description: typeof body.description === 'string' ? body.description : null,
    mode,
    status: 'DRAFT',
    connectionIds: Array.isArray(body.connectionIds) ? body.connectionIds.filter((x) => typeof x === 'string') : [],
    latestVersion: 1,
    testedVersion: null,
    pendingSync: true,
    updatedAt: at,
    runs24h: 0,
    pendingApprovals: 0,
    pauseReason: null,
    definition: body.definition ?? null,
    versions: [{ version: 1, createdAt: at, mode }],
  };
}

function patchView(view: WorkflowView, body: unknown, at: string): WorkflowView {
  const patch = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const mode = typeof patch.mode === 'string' ? patch.mode : view.mode;
  return {
    ...view,
    name: typeof patch.name === 'string' && patch.name.trim() ? patch.name : view.name,
    description: patch.description === undefined ? view.description : typeof patch.description === 'string' ? patch.description : null,
    mode,
    connectionIds: Array.isArray(patch.connectionIds)
      ? patch.connectionIds.filter((x) => typeof x === 'string')
      : view.connectionIds,
    definition: patch.definition === undefined ? view.definition : patch.definition,
    updatedAt: at,
    pendingSync: true,
    versions: [{ version: 1, createdAt: at, mode }],
  };
}

function createsWorkflow(path: string) {
  return path === '/workflows' || path === '/workflows/import';
}

/** Pure update used by the phone queue and by tests. `inFlight` is the item already on the wire. */
export function applyQueue(items: OutboxItem[], req: QueueRequest, inFlight: string | null): OutboxItem[] {
  const local = localIdIn(req.path);
  const touched =
    local && (req.method === 'PATCH' || req.method === 'PUT')
      ? items.map((item) =>
          item.localId === local && item.view ? { ...item, view: patchView(item.view, req.body, req.now), error: undefined } : item,
        )
      : items;
  const same = touched.findIndex((item) => item.method === req.method && item.path === req.path);
  if (same >= 0 && touched[same]?.id !== inFlight) {
    const prev = touched[same]!;
    const replaced: OutboxItem = {
      ...prev,
      body: req.body,
      idempotencyKey: req.idempotencyKey,
      createdAt: req.now,
      error: undefined,
    };
    return touched.map((item, i) => (i === same ? replaced : item));
  }
  if (touched.length >= MAX_ITEMS) return items;
  const view =
    req.localId && createsWorkflow(req.path) && req.body && typeof req.body === 'object'
      ? workflowView(req.body as Record<string, unknown>, req.localId, req.now)
      : undefined;
  return [
    ...touched,
    {
      id: req.id,
      method: req.method,
      path: req.path,
      body: req.body,
      idempotencyKey: req.idempotencyKey,
      createdAt: req.now,
      label: req.path,
      localId: req.localId,
      view,
    },
  ];
}

function read(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(STORE);
    const parsed = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]) {
  localStorage.setItem(STORE, JSON.stringify(items));
  listeners.forEach((fn) => fn());
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ID_MAP);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>) {
  localStorage.setItem(ID_MAP, JSON.stringify(map));
}

function setStatus(patch: Partial<Status>) {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn());
}

export function readOutbox(): OutboxItem[] {
  return read();
}

export function pendingWorkflows(): WorkflowView[] {
  return read()
    .map((item) => item.view)
    .filter((view): view is WorkflowView => !!view);
}

export function localWorkflow(id: string): WorkflowView | null {
  return read().find((item) => item.localId === id)?.view ?? null;
}

export function subscribeOutbox(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearOutboxErrors() {
  write(read().map((item) => ({ ...item, error: undefined })));
  setStatus({ note: null });
}

export function outboxStatus() {
  return { ...status, count: read().length };
}

/** Stores a create or edit. Returns the phone-only id when this call created a new record. */
export function enqueue(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): string | undefined {
  const now = new Date().toISOString();
  const localId = method === 'POST' && !path.split('?')[0]?.includes('/local-') && path.split('/').filter(Boolean).length <= 2 && !path.includes('/local-')
    ? assignLocal(path)
    : undefined;
  const req: QueueRequest = {
    method,
    path,
    body,
    now,
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    localId,
  };
  const current = read();
  const next = applyQueue(current, req, sendingId);
  const stored = next.some((item) => item.id === req.id || item.idempotencyKey === req.idempotencyKey);
  if (!stored) throw new Error('This phone already has too many changes waiting to sync.');
  write(next);
  setStatus({ note: null });
  return localId;
}

function assignLocal(path: string): string | undefined {
  const parts = path.split('?')[0]?.split('/').filter(Boolean) ?? [];
  if (parts.length === 1) return `local-${crypto.randomUUID()}`;
  if (parts.length === 2 && parts[1] === 'import') return `local-${crypto.randomUUID()}`;
  return undefined;
}

export function useOutbox() {
  const [snap, setSnap] = useState({ count: 0, note: null as string | null, syncing: false, online: true });
  useEffect(() => {
    const pull = () => {
      const s = outboxStatus();
      setSnap({ count: s.count, note: s.note, syncing: s.syncing, online: navigator.onLine });
    };
    pull();
    const stop = subscribeOutbox(pull);
    window.addEventListener('online', pull);
    window.addEventListener('offline', pull);
    return () => {
      stop();
      window.removeEventListener('online', pull);
      window.removeEventListener('offline', pull);
    };
  }, []);
  return snap;
}

export function flushOutbox(force = false) {
  if (running) return running;
  running = flushOnce(force).finally(() => {
    running = null;
  });
  return running;
}

async function flushOnce(force: boolean) {
  if (!force && typeof navigator !== 'undefined' && navigator.onLine === false) return;
  setStatus({ syncing: true, note: null });
  try {
    for (let n = 0; n < MAX_ITEMS; n++) {
      const item = read().find((row) => !row.error);
      if (!item) {
        setStatus({ note: null });
        return;
      }
      sendingId = item.id;
      const path = rewritePath(item.path, readMap());
      let res: Response;
      try {
        res = await fetch(`/api/v1${path}`, {
          method: item.method,
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-requested-with': 'creatoros',
            'idempotency-key': item.idempotencyKey,
          },
          body: JSON.stringify(item.body ?? {}),
        });
      } catch {
        setStatus({ note: null });
        return;
      } finally {
        sendingId = null;
      }
      if (res.status === 401) {
        setStatus({ note: 'Sign in to finish saving these changes.' });
        return;
      }
      if (res.status === 409 || res.status >= 500) return;
      if (!res.ok) {
        let message = `Could not save (${res.status}).`;
        try {
          const json = (await res.json()) as { error?: { message?: string } };
          if (json?.error?.message) message = json.error.message;
        } catch {
          /* keep the status message */
        }
        write(read().map((row) => (row.id === item.id ? { ...row, error: message } : row)));
        setStatus({ note: message });
        return;
      }
      let data: { id?: string } | null = null;
      try {
        const json = (await res.json()) as { data?: { id?: string } };
        data = json?.data ?? null;
      } catch {
        data = null;
      }
      if (item.localId) {
        const serverId = data?.id;
        if (!serverId) {
          write(read().map((row) => (row.id === item.id ? { ...row, error: 'The server did not return the new record.' } : row)));
          setStatus({ note: 'The server did not return the new record.' });
          return;
        }
        writeMap({ ...readMap(), [item.localId]: serverId });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cos-outbox-synced', { detail: { localId: item.localId, serverId } }));
        }
      }
      write(read().filter((row) => row.id !== item.id));
      afterSync(path);
    }
  } finally {
    sendingId = null;
    setStatus({ syncing: false });
  }
}
