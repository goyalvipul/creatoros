import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {brands,creativeProjects,sql,fileInstances,generationJobs,generationOutputs,logicalAssets,assetVersions,distributionVariants,publishItems,channels,socialAccounts,publishDrafts,devices,eq} from '@creatoros/db';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {productionReadiness,finalizeChatGPTProduction,saveSocialCoverBytes} from '@creatoros/services';
import {startProductionRun,recordProductionPlanning,assertRunSubmission,controlProductionRun,setProductionPreference,setAutomatedProjectStage,productionRunBoard} from '@creatoros/services';
import {freshDb,makeOrg,pairTestDevice,makeRoot} from '../src/helpers';
let fresh:Awaited<ReturnType<typeof freshDb>>;
beforeAll(async()=>{fresh=await freshDb();});
afterAll(async()=>{await fresh?.drop();});
describe('durable production runs',()=>{
 it('deduplicates runs, enforces creator ownership, tracks control events and advances project stage',async()=>{
  const {ctx}=await makeOrg(fresh.handle);
  const {ctx:other}=await makeOrg(fresh.handle);
  const [brand]=await ctx.db.insert(brands).values({orgId:ctx.orgId,name:'Fitness'}).returning();
  const [project]=await ctx.db.insert(creativeProjects).values({orgId:ctx.orgId,brandId:brand!.id,title:'Squat Form'}).returning();
  const day=(await ctx.db.execute(sql`select to_char(now() at time zone 'America/Vancouver','YYYY-MM-DD') as day`)).rows[0]!.day as string;
  const input={brandId:brand!.id,localDay:day,target:2};
  const run=await startProductionRun(ctx,input);
  expect((await startProductionRun(ctx,input)).id).toBe(run.id);
  await expect(startProductionRun(other,input)).rejects.toThrow();
  await expect(assertRunSubmission(ctx,run.id,project!.id)).rejects.toThrow();
  await recordProductionPlanning(ctx,{runId:run.id,stage:'PLANNED',detail:'Test source evidence'});
  expect(await assertRunSubmission(ctx,run.id,project!.id)).toBeNull();
  await controlProductionRun(ctx,run.id,'pause');
  await expect(assertRunSubmission(ctx,run.id,project!.id)).rejects.toThrow();
  await controlProductionRun(ctx,run.id,'resume');
  await setProductionPreference(ctx,brand!.id,{paused:true});
  await expect(startProductionRun(ctx,input)).rejects.toThrow();
  await setProductionPreference(ctx,brand!.id,{paused:false,billablePostprocess:true});
  await ctx.db.transaction(tx=>setAutomatedProjectStage(tx,ctx.orgId,project!.id,'IN_PROGRESS','Queued'));
  await ctx.db.transaction(tx=>setAutomatedProjectStage(tx,ctx.orgId,project!.id,'READY','Verified package'));
  const stage=(await ctx.db.execute(sql`select stage from creative_projects where id=${project!.id}`)).rows[0]?.stage;
  expect(stage).toBe('READY');
  const board=await productionRunBoard(ctx,run.id);
  expect(board.events.length).toBeGreaterThanOrEqual(4);
  expect(board.preferences[brand!.id]?.billablePostprocess).toBe(true);
  await expect(productionRunBoard(other,run.id)).rejects.toThrow();
  await controlProductionRun(ctx,run.id,'stop');
  await expect(controlProductionRun(ctx,run.id,'resume')).rejects.toThrow();
 });
});

describe('ChatGPT production finalization',()=>{
 it('requires matching quality, every connected draft and every actual saved cover before READY',async()=>{
  const {ctx}=await makeOrg(fresh.handle);
  const {ctx:other}=await makeOrg(fresh.handle);
  const directory=await mkdtemp(join(tmpdir(),'kk-finalize-test-'));
  ctx.env={...ctx.env,mediaPreviewDir:directory};
  try{
   const [brand]=await ctx.db.insert(brands).values({orgId:ctx.orgId,name:'External fixture'}).returning();
   const [project]=await ctx.db.insert(creativeProjects).values({orgId:ctx.orgId,brandId:brand!.id,title:'External test'}).returning();
   const device=await pairTestDevice(ctx);
   await ctx.db.update(devices).set({state:'ONLINE'}).where(eq(devices.id,device.deviceId));
   const root=await makeRoot(ctx,device.deviceId);
   const [file]=await ctx.db.insert(fileInstances).values({orgId:ctx.orgId,rootId:root.id,deviceId:device.deviceId,displayPath:'D:\\Media\\fixture.mp4',canonicalPath:'d:/media/fixture.mp4',fileName:'fixture.mp4',fileType:'VIDEO',size:1234,mtime:new Date()}).returning();
   const [asset]=await ctx.db.insert(logicalAssets).values({orgId:ctx.orgId,brandId:brand!.id,projectId:project!.id,title:'Fixture'}).returning();
   const [version]=await ctx.db.insert(assetVersions).values({orgId:ctx.orgId,assetId:asset!.id}).returning();
   const [job]=await ctx.db.insert(generationJobs).values({orgId:ctx.orgId,projectId:project!.id,provider:'comfyui-h3',status:'SUCCEEDED',settings:{creativeOwner:'chatgpt'}}).returning();
   const [output]=await ctx.db.insert(generationOutputs).values({orgId:ctx.orgId,jobId:job!.id,fileInstanceId:file!.id,assetVersionId:version!.id,outputRole:'final'}).returning();
   const [variant]=await ctx.db.insert(distributionVariants).values({orgId:ctx.orgId,assetId:asset!.id,assetVersionId:version!.id,projectId:project!.id,brandId:brand!.id,titleMaster:'Fixture'}).returning();
   const [item]=await ctx.db.insert(publishItems).values({orgId:ctx.orgId,variantId:variant!.id,fileInstanceId:file!.id}).returning();
   const [channel]=await ctx.db.insert(channels).values({orgId:ctx.orgId,brandId:brand!.id,name:'Fixture'}).returning();
   const [account]=await ctx.db.insert(socialAccounts).values({orgId:ctx.orgId,channelId:channel!.id,platform:'youtube',handle:'@fixture'}).returning();
   const target={jobId:job!.id,fileId:file!.id};
   await expect(productionReadiness(other,target)).rejects.toThrow();
   expect((await finalizeChatGPTProduction(ctx,target)).missing).toContain('QUALITY_REPORT_PASS');
   // Persist a fixture report directly: this test exercises the finalizer, not live FFmpeg or scanner fetch.
   const mtime=(await ctx.db.execute(sql`select mtime::text as mtime from file_instances where id=${file!.id}`)).rows[0]?.mtime;
   await ctx.db.execute(sql`update generation_jobs set settings=settings||${JSON.stringify({productionQualityPassed:true,qualityReport:{fileId:file!.id,outputId:output!.id,size:1234,mtime,verdict:'PASS'}})}::jsonb where id=${job!.id}`);
   expect((await productionReadiness(ctx,target)).missing).toContain('DRAFT:'+account!.id);
   await ctx.db.insert(publishDrafts).values({orgId:ctx.orgId,itemId:item!.id,socialAccountId:account!.id,title:'Fixture',caption:'Fixture description',hashtags:['fixture'],aiUse:'YES',privacy:'PRIVATE'});
   expect((await finalizeChatGPTProduction(ctx,target)).missing).toContain('COVER:'+account!.id);
   const cover=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2sAAAAASUVORK5CYII=','base64');
   await saveSocialCoverBytes(ctx,project!.id,item!.id,account!.id,cover);
   const finalized=await finalizeChatGPTProduction(ctx,target);
   expect(finalized.ready).toBe(true);expect(finalized.stage).toBe('READY');
   expect(finalized.accounts[0]?.coverSha256).toBe(createHash('sha256').update(cover).digest('hex'));
   expect((await productionReadiness(ctx,target)).stage).toBe('READY');
  }finally{await rm(directory,{recursive:true,force:true});}
 });
});
