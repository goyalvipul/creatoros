import { describe, expect, it } from 'vitest';
import { canExecuteCreative, creativeOperations, dailyGatewayLimit, generationLimit, imageUploadLimit, isDedicatedImageOperation, matchesDedicatedUploadRoot } from './ai-gateway-production-policy';
describe('creative execution boundary',()=>{
  it('requires the explicit execution scope',()=>expect(canExecuteCreative(['projects.write'],'projects.create')).toBe(false));
  it('classifies internal operations only',()=>{
    for(const name of ['projects.create','generation.h3','generation.ltx','generation.autogen','generation.longscene','media.uploadImage','media.uploadAudio','publishing.draft','publishing.thumbnail','production.qualityReport','production.finalize'])expect(canExecuteCreative(['production.execute'],name)).toBe(true);
    for(const name of ['publishing.schedule','publishing.cancel','publishing.reschedule','replies.send','generation.cancelClip','generation.cancelScene','media.analyze','generation.image','media.importGeneratedImage','production.runControl','production.planSubmit','production.planRecover','generation.localImage','generation.localImageCancel','unknown','constructor','__proto__'])expect(canExecuteCreative(['production.execute'],name)).toBe(false);
    expect(new Set(creativeOperations).size).toBe(creativeOperations.length);
  });
});

describe('configured gateway limits and dedicated upload boundary',()=>{
  const rootId='1726b745-c863-4869-beab-700bec01b03f';
  const root={display_path:'D:\\ChatGPT_Uploads',path_os:'windows'};
  it('preserves defaults and accepts explicit limits including zero',()=>{
    expect(generationLimit({})).toBe(2);expect(imageUploadLimit({})).toBe(24);
    expect(generationLimit({AI_GATEWAY_DAILY_GENERATION_LIMIT:'8'})).toBe(8);
    expect(generationLimit({AI_GATEWAY_DAILY_GENERATION_LIMIT:'0'})).toBe(0);
    for(const raw of ['-1','2.5','NaN','1001',' '])expect(()=>dailyGatewayLimit(raw,2,'LIMIT')).toThrow();
  });
  it('only recognizes the configured UUID and exact dedicated Windows path',()=>{
    expect(matchesDedicatedUploadRoot(rootId,rootId,root)).toBe(true);
    expect(matchesDedicatedUploadRoot(undefined,rootId,root)).toBe(false);
    expect(matchesDedicatedUploadRoot('invalid','invalid',root)).toBe(false);
    expect(matchesDedicatedUploadRoot(rootId,'other',root)).toBe(false);
    expect(matchesDedicatedUploadRoot(rootId,rootId,{...root,display_path:'D:\\ComfyUI\\output'})).toBe(false);
    expect(matchesDedicatedUploadRoot(rootId,rootId,{...root,path_os:'posix'})).toBe(false);
    expect(matchesDedicatedUploadRoot(rootId,rootId,{...root,display_path:root.display_path+'-other'})).toBe(false);
    expect(matchesDedicatedUploadRoot(rootId,rootId,undefined)).toBe(false);
  });
  it('does not extend the dedicated exemption to audio or publishing',()=>{
    expect(isDedicatedImageOperation('media.prepareImageUpload')).toBe(true);
    expect(isDedicatedImageOperation('media.uploadImage')).toBe(true);
    for(const op of ['media.prepareAudioUpload','media.uploadAudio','publishing.thumbnail','generation.h3'])expect(isDedicatedImageOperation(op)).toBe(false);
  });
});

import {operations} from './ai-gateway-operations';
describe('production finalization catalogue',()=>{
 it('accepts exactly one thumbnail source and exposes scoped finalization',()=>{
  const itemId='00000000-0000-4000-8000-000000000001',socialAccountId='00000000-0000-4000-8000-000000000002',fileId='00000000-0000-4000-8000-000000000003';
  const schema=operations['publishing.thumbnail']!.schema;
  expect(schema.safeParse({itemId,socialAccountId,fileId}).success).toBe(true);
  expect(schema.safeParse({itemId,socialAccountId,base64:'YWJj'}).success).toBe(true);
  expect(schema.safeParse({itemId,socialAccountId,fileId,base64:'YWJj'}).success).toBe(false);
  expect(schema.safeParse({itemId,socialAccountId}).success).toBe(false);
  expect(operations['production.readiness']).toMatchObject({write:false,scope:'projects.read'});
  expect(operations['production.finalize']).toMatchObject({write:true,scope:'projects.update'});
 });
});
