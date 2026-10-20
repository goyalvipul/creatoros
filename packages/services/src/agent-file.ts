import { sql, type Db } from '@creatoros/db';
import { AppError, type ServiceEnv } from './types';
import { getDeviceSigningKey, signAgentFetch } from './devices';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

export interface AgentFile {
  body: ReadableStream<Uint8Array>;
  size: number;
  mime: string;
  name: string;
}

/** Reads one file from the owning agent. The original is not modified. The machine must be online. */
export async function openAgentFile(
  db: Db,
  env: ServiceEnv,
  orgId: string,
  fileInstanceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentFile> {
  const [f] = rowsOf<{
    id: string;
    rootId: string;
    displayPath: string;
    fileName: string;
    mime: string | null;
    size: number;
    availability: string;
    deviceId: string;
    deviceState: string;
    listenUrls: string[];
    rootState: string;
  }>(
    await db.execute(sql`
      select f.id, f.root_id as "rootId", f.display_path as "displayPath", f.file_name as "fileName", f.mime, f.size::float8 as size,
             f.availability, d.id as "deviceId", d.state as "deviceState", d.listen_urls as "listenUrls", r.state as "rootState"
      from file_instances f join devices d on d.id = f.device_id join storage_roots r on r.id = f.root_id
      where f.id = ${fileInstanceId} and f.org_id = ${orgId}`),
  );
  if (!f) throw new AppError(404, 'NOT_FOUND', 'File not found');
  if (f.deviceState !== 'ONLINE' || f.rootState === 'UNREACHABLE')
    throw new AppError(
      503,
      'DEVICE_OFFLINE',
      'The machine that holds this file is offline right now. It is not missing; publish again when it is back.',
    );
  if (['CONFIRMED_MISSING', 'MISSING_CANDIDATE'].includes(f.availability))
    throw new AppError(410, 'FILE_MISSING', 'This file was not found on its machine during the last scan.');
  const key = await getDeviceSigningKey(env, f.deviceId, db);
  if (!key) throw new AppError(503, 'NO_KEY', 'Device cannot serve files.');
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const sig = signAgentFetch(key, f.rootId, f.displayPath, exp);
  const loopback = env.processEnv.AGENT_LOOPBACK_HOST;
  const urls = (f.listenUrls ?? []).map((u) =>
    loopback ? u.replace(/\/\/(127\.0\.0\.1|localhost)/, `//${loopback}`) : u,
  );
  if (!urls.length) throw new AppError(503, 'NO_LISTEN_URL', 'The agent has not reported an address the server can reach.');
  let lastErr = '';
  for (const base of urls) {
    try {
      const u = `${base.replace(/\/$/, '')}/v1/stream?root=${encodeURIComponent(f.rootId)}&path=${encodeURIComponent(f.displayPath)}&exp=${exp}&sig=${sig}`;
      const upstream = await fetchImpl(u);
      if (upstream.status === 404) throw new AppError(410, 'FILE_MISSING', 'The agent could not find this file on disk.');
      if (!upstream.ok || !upstream.body) {
        lastErr = `HTTP ${upstream.status}`;
        continue;
      }
      const size = Number(upstream.headers.get('content-length') ?? f.size);
      return {
        body: upstream.body,
        size: Number.isFinite(size) && size > 0 ? size : f.size,
        mime: f.mime || upstream.headers.get('content-type') || 'video/mp4',
        name: f.fileName,
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      lastErr = (e as Error).message;
    }
  }
  throw new AppError(503, 'AGENT_UNREACHABLE', `Could not reach the agent (${lastErr}).`);
}
