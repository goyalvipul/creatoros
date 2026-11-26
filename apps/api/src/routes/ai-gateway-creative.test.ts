import { describe, expect, it } from 'vitest';
import { canExecuteCreative, creativeOperations } from './ai-gateway-production-policy';
describe('creative execution boundary',()=>{
  it('requires the explicit execution scope',()=>expect(canExecuteCreative(['projects.write'],'projects.create')).toBe(false));
  it('classifies internal operations only',()=>{
    for(const name of ['projects.create','generation.h3','generation.ltx','generation.autogen','generation.longscene','media.uploadImage','media.uploadAudio','publishing.draft','publishing.thumbnail'])expect(canExecuteCreative(['production.execute'],name)).toBe(true);
    for(const name of ['publishing.schedule','publishing.cancel','publishing.reschedule','replies.send','generation.cancelClip','generation.cancelScene','media.analyze','unknown','constructor','__proto__'])expect(canExecuteCreative(['production.execute'],name)).toBe(false);
    expect(new Set(creativeOperations).size).toBe(creativeOperations.length);
  });
});
