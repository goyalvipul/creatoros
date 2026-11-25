import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql } from '@creatoros/db';
import { audit, createProject, forbidden, unauthorized, type Ctx } from '@creatoros/services';
import { makeRouter, type AppDeps } from '../http';

const mode = z.enum(['local','hosted']);
const scope = z.enum(['projects.read','media.read','projects.write']);
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;
type State = { enabled: boolean; mode: 'local'|'hosted'; scopes: string[]; local_configured: boolean; hosted_configured: boolean; local_seen: string|null; hosted_seen: string|null };
async function state(ctx: Ctx): Promise<State> {
  const [r] = rows<State>(await ctx.db.execute(sql`select enabled, mode, scopes, local_hash is not null as local_configured, hosted_hash is not null as hosted_configured, local_seen, hosted_seen from ai_gateway_connections where org_id = ${ctx.orgId}`));
  return r ?? {enabled:false,mode:'hosted',scopes:['projects.read','media.read'],local_configured:false,hosted_configured:false,local_seen:null,hosted_seen:null};
}
export function aiGatewayRoutes(app: FastifyInstance, deps: AppDeps) {
  const route = makeRouter(app,deps);
  route({method:'GET',url:'/integrations/ai-gateway',tag:'AI Gateway',summary:'Gateway settings',role:'OWNER'},async ({ctx,reply})=>{reply.header('cache-control','no-store');return state(ctx);});
  route({method:'POST',url:'/integrations/ai-gateway/settings',tag:'AI Gateway',summary:'Update gateway settings',role:'OWNER',body:z.object({enabled:z.boolean(),mode,scopes:z.array(scope).max(3)})},async ({ctx,body})=>{
    await ctx.db.execute(sql`insert into ai_gateway_connections(org_id,enabled,mode,scopes) values (${ctx.orgId},${body.enabled},${body.mode},ARRAY[${sql.join(body.scopes.map(s=>sql`${s}`),sql`,`)}]::text[]) on conflict(org_id) do update set enabled=excluded.enabled,mode=excluded.mode,scopes=excluded.scopes`);
    await audit(ctx,'ai_gateway.settings',{type:'organization',id:ctx.orgId},undefined,body);
    return state(ctx);
  });
  route({method:'POST',url:'/integrations/ai-gateway/credential',tag:'AI Gateway',summary:'Rotate or revoke connector credential',role:'OWNER',body:z.object({mode,action:z.enum(['rotate','revoke'])})},async ({ctx,body,req,reply})=>{
    if(req.headers['idempotency-key']) throw forbidden('Credential operations do not accept idempotency keys.');
    reply.header('cache-control','no-store');
    const token=body.action==='rotate'?'kk_'+body.mode+'_'+randomBytes(32).toString('hex'):null;
    const hash=token?digest(token):null;
    await ctx.db.execute(sql`insert into ai_gateway_connections(org_id) values(${ctx.orgId}) on conflict do nothing`);
    if(body.mode==='local') await ctx.db.execute(sql`update ai_gateway_connections set local_hash=${hash},local_owner=${token?ctx.userId:null},local_seen=null where org_id=${ctx.orgId}`);
    else await ctx.db.execute(sql`update ai_gateway_connections set hosted_hash=${hash},hosted_owner=${token?ctx.userId:null},hosted_seen=null where org_id=${ctx.orgId}`);
    await audit(ctx,'ai_gateway.'+body.action,{type:'organization',id:ctx.orgId},undefined,{mode:body.mode});
    return {token,settings:await state(ctx)};
  });
  async function authenticate(req: FastifyRequest, required?: string): Promise<Ctx> {
    const match=/^Bearer (kk_(local|hosted)_[a-f0-9]{64})$/.exec(req.headers.authorization??'');
    if(!match) throw unauthorized();
    const hash=digest(match[1]!);
    const local=match[2]==='local';
    const [r]=rows<{org_id:string;user_id:string;scopes:string[]}>(await deps.db.execute(sql`select g.org_id,m.user_id,g.scopes from ai_gateway_connections g join organization_memberships m on m.org_id=g.org_id and m.user_id=case when ${local} then g.local_owner else g.hosted_owner end join users u on u.id=m.user_id where g.enabled and g.mode=${match[2]} and (case when ${local} then g.local_hash else g.hosted_hash end)=${hash} and m.role='OWNER' and m.status='ACTIVE' and u.status='ACTIVE'`));
    if(!r) throw unauthorized();
    if(required&&!r.scopes.includes(required)) throw forbidden('Gateway permission not enabled.');
    const ctx:Ctx={db:deps.db,env:deps.config.env,orgId:r.org_id,userId:r.user_id,actor:{type:'user',id:r.user_id},now:deps.now??(()=>new Date()),correlationId:req.correlationId,ip:req.ip};
    if(local) await deps.db.execute(sql`update ai_gateway_connections set local_seen=now() where org_id=${r.org_id} and local_hash=${hash}`);
    else await deps.db.execute(sql`update ai_gateway_connections set hosted_seen=now() where org_id=${r.org_id} and hosted_hash=${hash}`);
    await audit(ctx,'ai_gateway.request',{type:'organization',id:r.org_id},undefined,{mode:match[2],method:req.method,path:req.url.split('?')[0]});
    return ctx;
  }
  const envelope=(req:FastifyRequest,data:unknown)=>({data,meta:{requestId:req.correlationId},error:null});
  app.get('/ai-gateway/status',async(req,reply)=>{const ctx=await authenticate(req);reply.header('cache-control','no-store');const s=await state(ctx);return envelope(req,{mode:s.mode,scopes:s.scopes});});
  app.get('/ai-gateway/projects',async(req,reply)=>{const ctx=await authenticate(req,'projects.read');reply.header('cache-control','no-store');return envelope(req,rows(await ctx.db.execute(sql`select id,title,stage,brief from creative_projects where org_id=${ctx.orgId} and deleted_at is null order by created_at desc limit 50`)));});
  app.get('/ai-gateway/videos',async(req,reply)=>{const ctx=await authenticate(req,'media.read');reply.header('cache-control','no-store');return envelope(req,rows(await ctx.db.execute(sql`select id,file_name,tech from file_instances where org_id=${ctx.orgId} and file_type='VIDEO' and archived_at is null and availability='AVAILABLE' order by created_at desc limit 50`)));});
  app.get('/ai-gateway/videos/:id/analysis',async(req,reply)=>{const ctx=await authenticate(req,'media.read');reply.header('cache-control','no-store');const {id}=z.object({id:z.uuid()}).parse(req.params);return envelope(req,rows(await ctx.db.execute(sql`select j.id,j.status,j.output,j.finished_at from ai_jobs j join file_instances f on f.id::text=j.target_id and f.org_id=j.org_id where j.org_id=${ctx.orgId} and f.id=${id} and j.target_type='file' and j.task='video_analysis' order by j.created_at desc limit 5`)));});
  app.post('/ai-gateway/projects',async(req,reply)=>{const ctx=await authenticate(req,'projects.write');reply.header('cache-control','no-store');const body=z.object({title:z.string().trim().min(1).max(200),brief:z.string().max(4000).optional()}).strict().parse(req.body);return envelope(req,await createProject(ctx,{...body,type:'OTHER',contentFormat:'OTHER'}));});
}
