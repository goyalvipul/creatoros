import { describe, expect, it } from 'vitest';
import { agentEventPayload, agentTaskInput, agentTaskResult, validateAgentResult } from './agent-task-contract';
const id = 'c17b22af-4153-4a42-abf6-f8a5934cf933';
const other = 'c17b22af-4153-4a42-abf6-f8a5934cf934';
describe('Agent task version 1', () => {
  it('keeps instructions and references out of webhook payloads', () => {
    const payload = agentEventPayload(id, 'IMAGE_GENERATION', new Date(0));
    expect(payload.data).toEqual({ requestId: id, taskType: 'IMAGE_GENERATION', schemaVersion: 1 });
    expect(payload.eventId).toBe(id);
    expect(payload.cursor).toBeNull();
  });
  it('rejects unregistered tasks and extra fields', () => {
    const common = { brandId: id, projectId: null, instructions: 'Draft a script' };
    expect(agentTaskInput.safeParse({ ...common, taskType: 'PUBLISH' }).success).toBe(false);
    expect(agentTaskInput.safeParse({ ...common, taskType: 'SCRIPT_GENERATION', secret: 'no' }).success).toBe(false);
    expect(agentTaskInput.safeParse({ ...common, taskType: 'IMAGE_GENERATION', referenceFileIds: [], aspect: '9:16' }).success).toBe(false);
  });
  it('requires unique references and a project for image tasks', () => {
    const common = { brandId: id, projectId: other, instructions: 'Image', taskType: 'IMAGE_GENERATION', aspect: '9:16' };
    expect(agentTaskInput.safeParse({ ...common, referenceFileIds: [id, id] }).success).toBe(false);
    expect(agentTaskInput.safeParse({ ...common, referenceFileIds: [id] }).success).toBe(true);
  });
  it('requires typed output and matching task type', () => {
    const task = agentTaskInput.parse({ brandId: id, projectId: null, instructions: 'Script', taskType: 'SCRIPT_GENERATION' });
    expect(agentTaskResult.safeParse({ taskType: 'IMAGE_GENERATION', message: 'done' }).success).toBe(false);
    expect(() => validateAgentResult(task, { taskType: 'IMAGE_GENERATION', fileId: id, uploadRequestId: other, evidence: 'Observed image' })).toThrow('agent_result_type_mismatch');
    expect(validateAgentResult(task, { taskType: 'SCRIPT_GENERATION', title: 'Title', script: 'Script', limitations: [] }).taskType).toBe('SCRIPT_GENERATION');
  });
});

describe('Agent task version 2',()=>{
 const common={brandId:id,projectId:other,instructions:'Create approved original content.'};
 it('preserves old event versions and uses version two for new task types',()=>{
  expect(agentEventPayload(id,'VIDEO_REVIEW',new Date(0)).data.schemaVersion).toBe(2);
  expect(agentEventPayload(id,'IMAGE_GENERATION',new Date(0)).data.schemaVersion).toBe(1);
 });
 it('requires exact planned duration',()=>{
  const input=agentTaskInput.parse({...common,taskType:'PRODUCTION_PLANNING',durationSec:12,aspect:'9:16'});
  const result={taskType:'PRODUCTION_PLANNING',title:'Title',brief:'Brief',imagePrompt:'Image',masterPrompt:'Prompt',segments:[{prompt:'First',durationSec:6,continuity:'shot'},{prompt:'Second',durationSec:6,continuity:'context'}]};
  expect(validateAgentResult(input,result).taskType).toBe('PRODUCTION_PLANNING');
  expect(()=>validateAgentResult(input,{...result,segments:result.segments.slice(0,1)})).toThrow('agent_plan_duration_mismatch');
 });
 it('rejects incorrect provider reservations and mismatched charge evidence',()=>{
  expect(agentTaskInput.safeParse({...common,taskType:'RESEARCH',provider:'VIDIQ',query:'Fitness',reservedCredits:5,watch:true}).success).toBe(false);
  const input=agentTaskInput.parse({...common,taskType:'RESEARCH',provider:'VIDIQ',query:'Fitness',reservedCredits:5,watch:false});
  const result={taskType:'RESEARCH',provider:'VIDIQ',findings:[{videoId:'Abcdefghijk',url:'https://www.youtube.com/shorts/Abcdefghijk',title:'Fitness',finding:'Example',views:100,outlierScore:2}],analysis:null,creditEvidence:{balanceBefore:50,balanceAfter:45,charges:[{tool:'vidiq_outliers',credits:5,chargedAt:'2026-11-28T01:00:00Z'}]},limitations:[]};
  expect(validateAgentResult(input,result).taskType).toBe('RESEARCH');
  expect(()=>validateAgentResult(input,{...result,creditEvidence:{...result.creditEvidence,charges:[{tool:'vidiq_watch_shortform_content',credits:10,chargedAt:'2026-11-28T01:00:00Z'}]}})).toThrow('agent_research_charge_mismatch');
  expect(()=>validateAgentResult(input,{...result,findings:[{...result.findings[0],url:'https://www.youtube.com/shorts/WrongSource'}]})).toThrow('agent_invalid_source_url');
 });
 it('rejects incorrect publishing account sets',()=>{
  const input=agentTaskInput.parse({...common,taskType:'SEO_GENERATION',jobId:id,fileId:other,accounts:[{accountId:id,platform:'youtube'}]});
  const result={taskType:'SEO_GENERATION',drafts:[{accountId:id,title:'Title',caption:'Caption',hashtags:['fitness']}],thumbnailPrompt:'Thumbnail'};
  expect(validateAgentResult(input,result).taskType).toBe('SEO_GENERATION');
  expect(()=>validateAgentResult(input,{...result,drafts:[{...result.drafts[0],accountId:other}]})).toThrow('agent_account_mismatch');
 });
});
