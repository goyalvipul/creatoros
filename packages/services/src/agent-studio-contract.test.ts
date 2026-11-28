import { describe,expect,it } from 'vitest';
import { agentConfigSchema,scheduleDue,workflowStages,taskInstructions } from './agent-studio-contract';
const id='c17b22af-4153-4a42-abf6-f8a5934cf933';
const base={name:'Test',brandId:id,subscriptionId:'a'.repeat(64),workflow:'SCRIPT',schedule:{kind:'DAILY',time:'01:00'},instructions:'Original scripts',skills:[],memory:[],projectId:null,workerId:null,aspect:'9:16',durationSec:12,research:'NONE',dailyTasks:6,dailyImages:2,vidiqCredits:0};
describe('Agent Studio definitions',()=>{
 it('uses local daily slots rather than every scheduler tick',()=>{
  const c=agentConfigSchema.parse(base);
  expect(scheduleDue(c,'00:59')).toBe(false);expect(scheduleDue(c,'01:00')).toBe(true);
  expect(scheduleDue(c,'23:59')).toBe(true);
  expect(scheduleDue({...c,schedule:{kind:'MANUAL',time:'01:00'}},'23:59')).toBe(false);
 });
 it('fails closed on unmediated provider spending and missing render resources',()=>{
  expect(agentConfigSchema.safeParse({...base,vidiqCredits:20}).success).toBe(false);
  expect(agentConfigSchema.safeParse({...base,research:'VIDIQ'}).success).toBe(false);
  expect(agentConfigSchema.safeParse({...base,workflow:'H3_SHORT'}).success).toBe(false);
 });
 it('maps workflows to concrete ordered stages and snapshots instructions',()=>{
  const c=agentConfigSchema.parse({...base,workflow:'H3_SHORT',workerId:id});
  expect(workflowStages(c)).toEqual(['PRODUCTION_PLANNING','IMAGE_GENERATION','RENDER','VIDEO_REVIEW','SEO_GENERATION','THUMBNAIL','FINALIZE']);
  expect(taskInstructions({...c,skills:[{name:'Safety',instructions:'Use verified assets'}]},null)).toContain('Use verified assets');
 });
});

it('requires explicit provider risk acceptance and enough credits for the selected research',()=>{
 const c={...base,research:'VIDIQ',researchQuery:'beginner home fitness',vidiqCredits:5,acceptHostCreditRisk:true};
 expect(agentConfigSchema.safeParse(c).success).toBe(true);
 expect(agentConfigSchema.safeParse({...c,acceptHostCreditRisk:false}).success).toBe(false);
 expect(agentConfigSchema.safeParse({...c,vidiqWatch:true}).success).toBe(false);
 expect(workflowStages(agentConfigSchema.parse(c))).toEqual(['RESEARCH','CONTENT_STRATEGY','SCRIPT_GENERATION']);
});
it('requires explicit LTX audio and LoRA settings',()=>{
 const c={...base,workflow:'LTX_SHORT',workerId:id};
 expect(agentConfigSchema.safeParse(c).success).toBe(false);
 expect(agentConfigSchema.safeParse({...c,ltx:{audioFileId:id,audioStartSec:0,loraName:'identity.safetensors',loraStrength:0.75}}).success).toBe(true);
});
