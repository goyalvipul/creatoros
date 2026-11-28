import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql } from '@creatoros/db';
import { AGENT_SUBSCRIBE, AGENT_EXECUTE, badRequest, conflict, forbidden, notFound, tooMany, type Ctx } from '@creatoros/services';
import { importBinaryMedia, MAX_BINARY_IMAGE_BYTES, MAX_BINARY_AUDIO_BYTES, validateMediaName } from './ai-gateway-media';

import { isDedicatedUploadRoot } from './ai-gateway-production-policy';

const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;
type Kind = 'IMAGE' | 'AUDIO';
type Auth = { ctx: Ctx; mode: 'local' | 'hosted'; hash: string; scopes: string[] };
export const binaryUploadSchema = z.object({
  rootId: z.uuid(), brandId: z.uuid(), projectId: z.uuid().nullable().optional(),
  fileName: z.string().min(1).max(120), mime: z.string().max(40),
  size: z.number().int().positive().max(MAX_BINARY_AUDIO_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type Input = z.infer<typeof binaryUploadSchema>;
type Session = { policy_authorized: boolean; id: string; operation: string; scope: string; input: unknown; result: { uploadState: string; expiresAt: string; [key: string]: unknown } };
const operations = ['media.prepareImageUpload','media.prepareAudioUpload'];
const kindOf = (operation: string): Kind => operation === operations[0] ? 'IMAGE' : 'AUDIO';
const maxOf = (kind: Kind) => kind === 'IMAGE' ? MAX_BINARY_IMAGE_BYTES : MAX_BINARY_AUDIO_BYTES;
export function validateBinaryInput(input: Input, kind: Kind) {
  validateMediaName(input,kind);
  if (input.size > maxOf(kind)) throw badRequest('Binary upload exceeds the media size limit.');
}
export async function prepareBinaryUpload(ctx: Ctx, input: Input, requestId: string, kind: Kind) {
  validateBinaryInput(input,kind);
  return ctx.db.transaction(async tx => {
    await tx.execute(sql`select id from organizations where id=${ctx.orgId} for update`);
    if (!rows(await tx.execute(sql`select id from brands where id=${input.brandId} and org_id=${ctx.orgId} and active and deleted_at is null`)).length) throw notFound('Creator');
    if (input.projectId && !rows(await tx.execute(sql`select id from creative_projects where id=${input.projectId} and org_id=${ctx.orgId} and brand_id=${input.brandId} and deleted_at is null`)).length) throw notFound('Creator project');
    if (!rows(await tx.execute(sql`select r.id from storage_roots r join devices d on d.id=r.device_id and d.org_id=r.org_id where r.id=${input.rootId} and r.org_id=${ctx.orgId} and r.state='ACTIVE' and r.retired_at is null and d.state='ONLINE'`)).length) throw badRequest('Choose an active root on an online scanner.');
    const [count] = rows<{n:number}>(await tx.execute(sql`select count(*)::int as n from ai_gateway_requests where org_id=${ctx.orgId} and operation in ('media.prepareImageUpload','media.prepareAudioUpload') and (status='RUNNING' or (status='COMPLETED' and result->>'uploadState' in ('OPEN','RECEIVING') and (result->>'expiresAt')::timestamptz>now()))`));
    if ((count?.n ?? 0) > 4) throw tooMany('Too many active upload sessions.');
    return { uploadState:'OPEN', expiresAt:new Date(ctx.now().getTime()+30*60_000).toISOString(), uploadPath:'/uploads/'+requestId, method:'PUT', contentType:'application/octet-stream', size:input.size, sha256:input.sha256 };
  });
}
async function loadSession(auth: Auth,id:string) {
  const [session]=rows<Session>(await auth.ctx.db.execute(sql`select id,operation,scope,input,result,policy_authorized from ai_gateway_requests where id=${id} and org_id=${auth.ctx.orgId} and mode=${auth.mode} and credential_hash=${auth.hash} and status='COMPLETED' and operation in ('media.prepareImageUpload','media.prepareAudioUpload')`));
  if (!session || !auth.scopes.includes(session.scope) || !session.result?.uploadState) throw notFound('Upload session');
  return session;
}
// A native upload reserved by an agent must still belong to an active claim.
async function checkTaskUpload(auth:Auth,id:string) {
  const [task]=rows<{ok:boolean}>(await auth.ctx.db.execute(sql`
    select (t.org_id=${auth.ctx.orgId} and t.owner_id=${auth.ctx.userId} and t.credential_hash=${auth.hash}
      and t.state in ('CLAIMED','RUNNING') and t.lease_until>now() and t.deadline_at>now()
      and s.revoked_at is null) as ok
    from agent_tasks t join mcp_agent_subscriptions s on s.id=t.subscription_id where t.upload_request_id=${id}
  `));
  if(task&&(!task.ok||auth.mode!=='hosted'||!auth.scopes.includes(AGENT_SUBSCRIBE)||!auth.scopes.includes(AGENT_EXECUTE)))
    throw forbidden('Agent upload authorization is no longer active.');
}
function sessionState(s:Session) {
  if (Date.parse(s.result.expiresAt)<=Date.now()) {
    if(s.result.uploadState==='OPEN')return 'EXPIRED';
    if(s.result.uploadState==='RECEIVING')return 'UNCERTAIN';
  }
  return s.result.uploadState;
}
async function setState(auth:Auth,id:string,expected:string,state:string,extra:Record<string,unknown>={}) {
  const result=await auth.ctx.db.execute(sql`update ai_gateway_requests set result=result||${JSON.stringify({...extra,uploadState:state})}::jsonb where id=${id} and org_id=${auth.ctx.orgId} and mode=${auth.mode} and credential_hash=${auth.hash} and status='COMPLETED' and result->>'uploadState'=${expected} ${expected==='OPEN'?sql`and (result->>'expiresAt')::timestamptz>now()`:sql``} returning id`);
  return rows(result).length===1;
}
// Bound aggregate in-process memory. Each incoming body is consumed incrementally and never stored in request JSON.
let receiving=0;
export async function readBinaryBody(body:Readable, size:number, sha256:string) {
  const chunks:Buffer[]=[]; let received=0; const hash=createHash('sha256');
  for await (const chunk of body) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    received+=bytes.length;
    if(received>size)throw badRequest('Upload exceeds declared content length.');
    hash.update(bytes); chunks.push(bytes);
  }
  if(received!==size||hash.digest('hex')!==sha256)throw badRequest('Upload length or checksum does not match.');
  return Buffer.concat(chunks,received);
}
export function registerBinaryUploadRoutes(app:FastifyInstance,authenticate:(req:FastifyRequest,required?:string)=>Promise<Auth>,envelope:(req:FastifyRequest,data:unknown)=>unknown) {
  app.get('/ai-gateway/uploads/:id',async req=>{
    const auth=await authenticate(req);const {id}=z.object({id:z.uuid()}).parse(req.params);
    const s=await loadSession(auth,id);return envelope(req,{...s.result,uploadState:sessionState(s)});
  });
  app.post('/ai-gateway/uploads/:id/cancel',async req=>{
    const auth=await authenticate(req);const {id}=z.object({id:z.uuid()}).parse(req.params);
    await loadSession(auth,id);
    if(!await setState(auth,id,'OPEN','CANCELLED'))throw conflict('Only an unused, unexpired upload can be cancelled.');
    return envelope(req,{uploadState:'CANCELLED'});
  });
  void app.register(async scoped=>{
    // Fastify inherits the parent's buffer parser. Remove it only inside this child
    // scope before installing the streaming parser; otherwise API startup throws
    // FST_ERR_CTP_ALREADY_PRESENT. Sibling routes keep the inherited buffer parser.
    if (scoped.hasContentTypeParser('application/octet-stream')) {
      scoped.removeContentTypeParser('application/octet-stream');
    }
    scoped.addContentTypeParser('application/octet-stream',(_req,payload,done)=>done(null,payload));
    scoped.put('/ai-gateway/uploads/:id',{bodyLimit:MAX_BINARY_AUDIO_BYTES,config:{rateLimit:{max:6,timeWindow:'1 minute'}}},async req=>{
      const auth=await authenticate(req);const {id}=z.object({id:z.uuid()}).parse(req.params);
      const s=await loadSession(auth,id);const state=sessionState(s);
      if(state==='COMPLETE')return envelope(req,s.result);
      if(state!=='OPEN')throw conflict('Upload is '+state+'. Check the original session; do not replay uncertain writes.');
      await checkTaskUpload(auth,id);
      const input=binaryUploadSchema.parse(s.input),kind=kindOf(s.operation);
      validateBinaryInput(input,kind);
      if(req.headers['content-type']!=='application/octet-stream'||req.headers['content-encoding']||req.headers['content-length']!==String(input.size)||!(req.body instanceof Readable))throw badRequest('Send raw binary with exact Content-Length and no compression.');
      if(receiving>=2)throw tooMany('Binary upload capacity is busy. Session remains open.');
      receiving++;
      let claimed=false,writing=false;
      try {
        claimed=await setState(auth,id,'OPEN','RECEIVING');
        if(!claimed)throw conflict('Upload session already claimed.');
        const body=req.body;
        const timer=setTimeout(()=>body.destroy(new Error('Upload timed out')),120_000);
        let bytes:Buffer;
        try{bytes=await readBinaryBody(body,input.size,input.sha256);}finally{clearTimeout(timer);}
        // Recheck credential and operation scope after receiving bytes, before writing to a scanner.
        const current=await authenticate(req,s.scope);
        if(current.hash!==auth.hash||current.ctx.orgId!==auth.ctx.orgId)throw forbidden('Upload authorization changed.');
        if(Date.parse(s.result.expiresAt)<=Date.now())throw conflict('Upload session expired.');
        await checkTaskUpload(current,id);
        if(s.policy_authorized&&kind==='IMAGE'&&!await isDedicatedUploadRoot(current.ctx,input.rootId))throw forbidden('Dedicated ChatGPT upload root authorization changed.');
        writing=true;
        const output=await importBinaryMedia(current.ctx,input,id,kind,bytes);
        if(!await setState(auth,id,'RECEIVING','COMPLETE',{output}))throw conflict('Upload result could not be recorded; inspect the original session.');
        return envelope(req,{uploadState:'COMPLETE',output});
      } catch(error) {
        if(claimed)await setState(auth,id,'RECEIVING',writing?'UNCERTAIN':'FAILED',{message:writing?'Check the scanner and library before retrying.':'Upload not written; request a new session if needed.'}).catch(()=>undefined);
        throw error;
      } finally {receiving--;}
    });
  });
}
