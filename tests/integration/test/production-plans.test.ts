import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { brands,creativeProjects,fileInstances,gpuWorkers,sql } from '@creatoros/db';
import { startProductionRun,controlProductionRun,submitProductionPlan,productionPlanStatus,productionRunBoard,runDueProductionPlans,runDueProduction,productionPlanInputSchema } from '@creatoros/services';
import { freshDb,makeOrg,testEnv,pairTestDevice,makeRoot } from '../src/helpers';
let fresh:Awaited<ReturnType<typeof freshDb>>;
beforeAll(async()=>{fresh=await freshDb();});
afterAll(async()=>{await fresh?.drop();});
describe('executable production plans',()=>{
  it('persists approved plans, respects pause and deduplicates replacement attempts',async()=>{
    // No provider or GPU request is made in this test.
    const env=testEnv({processEnv:{GEMINI_API_KEY:'fixture-not-a-real-key'}});
    const {ctx}=await makeOrg(fresh.handle,env);
    const {ctx:other}=await makeOrg(fresh.handle,env);
    const [brand]=await ctx.db.insert(brands).values({orgId:ctx.orgId,name:'Fitness'}).returning();
    const [project]=await ctx.db.insert(creativeProjects).values({orgId:ctx.orgId,brandId:brand!.id,title:'Reference exercise'}).returning();
    const [worker]=await ctx.db.insert(gpuWorkers).values({orgId:ctx.orgId,label:'Test GPU',baseUrl:'http://127.0.0.1:9'}).returning();
    const device=await pairTestDevice(ctx);
    const root=await makeRoot(ctx,device.deviceId);
    const [reference]=await ctx.db.insert(fileInstances).values({orgId:ctx.orgId,rootId:root.id,deviceId:device.deviceId,canonicalPath:'d:/media/ref.png',displayPath:'D:\\Media\\ref.png',fileName:'ref.png',ext:'png',mime:'image/png',size:32,fileType:'IMAGE'}).returning();
    const day=(await ctx.db.execute(sql`select to_char(now() at time zone 'America/Vancouver','YYYY-MM-DD') as day`)).rows[0]!.day as string;
    const run=await startProductionRun(ctx,{brandId:brand!.id,localDay:day,target:1});
    const input=productionPlanInputSchema.parse({runId:run.id,form:{projectId:project!.id,workerId:worker!.id,imageFileId:reference!.id,imageUploadName:null,imageUploadWorkerId:null,prompt:'Natural exercise movement',aspectRatio:'9:16 (Portrait Widescreen)',megapixels:1,audioLocked:false,shareAudio:false,segments:[{continuity:'shot',taskMode:'ref',prompt:'Keep form consistent',audioFileId:null,audioUploadName:null,audioUploadWorkerId:null,durationSec:8,images:[{fileId:reference!.id,uploadName:null,uploadWorkerId:null,shared:false}]}]},sourceEvidence:'Observed source motion for fixture',brief:'Exercise quality fixture',assets:[],qualityReferenceFileIds:[reference!.id],requireAudio:false,requireLipSync:false,requirePhysicalAccuracy:true,maxRegenerations:1,acceptBillableQuality:true});
    const requestId=randomUUID();
    expect((await submitProductionPlan(ctx,input,requestId)).id).toBe(requestId);
    expect((await submitProductionPlan(ctx,input,requestId)).id).toBe(requestId);
    await expect(submitProductionPlan(ctx,input,randomUUID())).rejects.toThrow();
    await expect(productionPlanStatus(other,requestId)).rejects.toThrow();
    await controlProductionRun(ctx,run.id,'pause');
    expect((await runDueProductionPlans(ctx.db,ctx.env)).advanced).toBe(0);
    await controlProductionRun(ctx,run.id,'resume');
    await runDueProductionPlans(ctx.db,ctx.env);
    await runDueProductionPlans(ctx.db,ctx.env);
    const first=await productionPlanStatus(ctx,requestId);
    expect(first.state).toBe('WAIT_VIDEO');
    expect(first.attempt).toBe(1);
    expect(first.attempts).toHaveLength(1);
    expect(first.jobId).toBeTruthy();
    // Simulate a confirmed succeeded render and an observed failed quality report.
    await ctx.db.execute(sql`update generation_jobs set status='SUCCEEDED',finished_at=now() where id=${first.jobId} and org_id=${ctx.orgId}`);
    expect((await runDueProduction(ctx.db,ctx.env)).advanced).toBe(0);
    await ctx.db.execute(sql`update production_plans set state='REGENERATE',quality='{"verdict":"FAIL"}'::jsonb,payload=payload||'{"corrections":["Reduce motion speed."]}'::jsonb where id=${requestId} and org_id=${ctx.orgId}`);
    await runDueProductionPlans(ctx.db,ctx.env);
    const second=await productionPlanStatus(ctx,requestId);
    expect(second.attempt).toBe(2);expect(second.attempts).toHaveLength(2);
    expect(second.jobId).not.toBe(first.jobId);
    const old=(await ctx.db.execute(sql`select settings from generation_jobs where id=${first.jobId}`)).rows[0]?.settings as Record<string,unknown>;
    expect(old.productionSuperseded).toBe(true);
    // A subsequent worker tick only waits; it does not create a third render.
    await runDueProductionPlans(ctx.db,ctx.env);
    expect((await productionPlanStatus(ctx,requestId)).attempts).toHaveLength(2);
    expect((await productionRunBoard(ctx,run.id)).plans).toHaveLength(1);
  });
});
