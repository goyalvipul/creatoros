import { z } from 'zod';
import { qualityReportSchema } from './production-quality';

export const AGENT_EVENT = 'kemokem.task.requested';
export const AGENT_SUBSCRIBE = 'agents.subscribe';
export const AGENT_EXECUTE = 'agents.execute';
export const AGENT_SCHEMA_VERSION = 2 as const;
export function agentTaskSchemaVersion(type:string):1|2 {return ['CONTENT_STRATEGY','SCRIPT_GENERATION','IMAGE_GENERATION'].includes(type)?1:2;}

// Only capabilities with concrete admission and result validators are advertised.
// New task types must add both schemas, authorization, and a delivery handler.
export const agentTaskTypes = ['CONTENT_STRATEGY', 'SCRIPT_GENERATION', 'IMAGE_GENERATION', 'RESEARCH', 'PRODUCTION_PLANNING', 'VIDEO_REVIEW', 'SEO_GENERATION'] as const;
const uuid = z.uuid();
const instructions = z.string().trim().min(1).max(20000);
const text = z.string().trim().min(1).max(20000);
const refs = z.array(uuid).max(8).refine(v => new Set(v).size === v.length, 'Duplicate reference');
const base = z.object({ brandId: uuid, projectId: uuid.nullable(), instructions });
const strategy = base.extend({ taskType: z.literal('CONTENT_STRATEGY') }).strict();
const script = base.extend({ taskType: z.literal('SCRIPT_GENERATION') }).strict();
const image = base.extend({
  taskType: z.literal('IMAGE_GENERATION'),
  projectId: uuid,
  referenceFileIds: refs,
  aspect: z.enum(['1:1', '9:16', '16:9', '4:5', '3:2', '2:3']),
}).strict();
const research = base.extend({taskType:z.literal('RESEARCH'),provider:z.literal('VIDIQ'),query:z.string().trim().min(1).max(500),reservedCredits:z.union([z.literal(5),z.literal(15)]),watch:z.boolean()}).strict().refine(r=>r.reservedCredits===(r.watch?15:5),'Reservation must match approved calls.');
const planning = base.extend({taskType:z.literal('PRODUCTION_PLANNING'),projectId:uuid,durationSec:z.number().int().min(3).max(30),aspect:z.enum(['9:16','16:9','1:1'])}).strict();
const video = base.extend({taskType:z.literal('VIDEO_REVIEW'),projectId:uuid,jobId:uuid,fileId:uuid,referenceFileIds:refs,frameSeconds:z.array(z.number().min(0).max(30)).min(1).max(4)}).strict();
const account=z.object({accountId:uuid,platform:z.string().min(1).max(40)}).strict();
const seo=base.extend({taskType:z.literal('SEO_GENERATION'),projectId:uuid,jobId:uuid,fileId:uuid,accounts:z.array(account).min(1).max(20)}).strict();
export const agentTaskInput = z.discriminatedUnion('taskType', [strategy, script, image,research,planning,video,seo]);
export type AgentTaskInput = z.infer<typeof agentTaskInput>;

const strategyResult = z.object({
  taskType: z.literal('CONTENT_STRATEGY'),
  concepts: z.array(z.object({ title: z.string().trim().min(1).max(200), rationale: text, brief: text }).strict()).min(1).max(5),
  limitations: z.array(z.string().max(1000)).max(10),
}).strict();
const scriptResult = z.object({
  taskType: z.literal('SCRIPT_GENERATION'),
  title: z.string().trim().min(1).max(200),
  script: text,
  limitations: z.array(z.string().max(1000)).max(10),
}).strict();
const imageResult = z.object({
  taskType: z.literal('IMAGE_GENERATION'),
  uploadRequestId: uuid,
  fileId: uuid,
  evidence: z.string().trim().min(1).max(2000),
}).strict();
const researchResult=z.object({taskType:z.literal('RESEARCH'),provider:z.literal('VIDIQ'),findings:z.array(z.object({videoId:z.string().regex(/^[A-Za-z0-9_-]{11}$/),url:z.url(),title:z.string().min(1).max(300),finding:z.string().min(1).max(2000),views:z.number().int().nonnegative().nullable(),outlierScore:z.number().nonnegative().nullable()}).strict()).min(1).max(10),analysis:z.object({videoId:z.string().regex(/^[A-Za-z0-9_-]{11}$/),jobId:z.string().min(1).max(500),observations:z.string().min(1).max(8000)}).strict().nullable(),creditEvidence:z.object({balanceBefore:z.number().int().nonnegative().nullable(),balanceAfter:z.number().int().nonnegative().nullable(),charges:z.array(z.object({tool:z.enum(['vidiq_outliers','vidiq_watch_shortform_content']),credits:z.union([z.literal(5),z.literal(10)]),chargedAt:z.iso.datetime({offset:true})}).strict()).min(1).max(2)}).strict(),limitations:z.array(z.string().max(1000)).max(10)}).strict();
const planResult=z.object({taskType:z.literal('PRODUCTION_PLANNING'),title:z.string().trim().min(1).max(200),brief:z.string().trim().min(1).max(12000),imagePrompt:z.string().trim().min(1).max(6000),masterPrompt:z.string().trim().min(1).max(12000),segments:z.array(z.object({prompt:z.string().trim().min(1).max(6000),durationSec:z.number().int().min(1).max(9),continuity:z.enum(['shot','context'])}).strict()).min(1).max(8)}).strict();
const videoResult=z.object({taskType:z.literal('VIDEO_REVIEW'),assessment:qualityReportSchema,frameSeconds:z.array(z.number().min(0).max(30)).min(1).max(4)}).strict();
const seoResult=z.object({taskType:z.literal('SEO_GENERATION'),drafts:z.array(z.object({accountId:uuid,title:z.string().trim().min(1).max(100),caption:z.string().trim().min(1).max(5000),hashtags:z.array(z.string().trim().min(1).max(100)).min(1).max(30)}).strict()).min(1).max(20),thumbnailPrompt:z.string().trim().min(1).max(4000)}).strict();
export const agentTaskResult = z.discriminatedUnion('taskType', [strategyResult, scriptResult, imageResult,researchResult,planResult,videoResult,seoResult]);
export type AgentTaskResult = z.infer<typeof agentTaskResult>;
export const agentTaskClaim = z.object({ requestId: uuid, claimToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const agentTaskProgress = agentTaskClaim.extend({ detail: z.string().trim().min(1).max(2000) }).strict();
export const agentTaskComplete = agentTaskClaim.extend({ result: agentTaskResult }).strict();
export const agentTaskFail = agentTaskClaim.extend({
  code: z.enum(['CAPABILITY_UNAVAILABLE','PERMISSION_DENIED','BUDGET_EXHAUSTED','PROVIDER_ERROR','INVALID_OUTPUT','UNKNOWN']),
  detail: z.string().trim().min(1).max(2000),
}).strict();
export function validateAgentResult(input: AgentTaskInput, result: unknown): AgentTaskResult {
  const parsed = agentTaskResult.parse(result);
  if (parsed.taskType !== input.taskType) throw new Error('agent_result_type_mismatch');
  if(input.taskType==='PRODUCTION_PLANNING'&&parsed.taskType==='PRODUCTION_PLANNING'&&parsed.segments.reduce((n,s)=>n+s.durationSec,0)!==input.durationSec)throw new Error('agent_plan_duration_mismatch');
  if(input.taskType==='VIDEO_REVIEW'&&parsed.taskType==='VIDEO_REVIEW'&&JSON.stringify(parsed.frameSeconds)!==JSON.stringify(input.frameSeconds))throw new Error('agent_frame_mismatch');
  if(input.taskType==='SEO_GENERATION'&&parsed.taskType==='SEO_GENERATION'){
    const expected=input.accounts.map(a=>a.accountId).sort(),actual=parsed.drafts.map(a=>a.accountId).sort();
    if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('agent_account_mismatch');
  }
  if(input.taskType==='RESEARCH'&&parsed.taskType==='RESEARCH'){
    const charges=parsed.creditEvidence.charges;
    if(charges.length!==(input.watch?2:1)||charges.filter(c=>c.tool==='vidiq_outliers'&&c.credits===5).length!==1||charges.reduce((n,c)=>n+c.credits,0)!==input.reservedCredits)throw new Error('agent_research_charge_mismatch');
    if(input.watch&&(!parsed.analysis||!parsed.findings.some(f=>f.videoId===parsed.analysis?.videoId)||!charges.some(c=>c.tool==='vidiq_watch_shortform_content'&&c.credits===10)))throw new Error('agent_research_analysis_missing');
    if(!input.watch&&parsed.analysis)throw new Error('agent_unreserved_analysis');
    for(const f of parsed.findings){const url=new URL(f.url);if(url.protocol!=='https:'||!['www.youtube.com','youtube.com','youtu.be'].includes(url.hostname)||(url.hostname==='youtu.be'?url.pathname.slice(1)!==f.videoId:!(url.pathname==='/shorts/'+f.videoId||(url.pathname==='/watch'&&url.searchParams.get('v')===f.videoId))))throw new Error('agent_invalid_source_url');}
  }
  return parsed;
}
export function agentEventPayload(requestId: string, taskType: AgentTaskInput['taskType'], createdAt: Date) {
  return { eventId: requestId, name: AGENT_EVENT, timestamp: createdAt.toISOString(),
    data: { requestId, taskType, schemaVersion: agentTaskSchemaVersion(taskType) }, cursor: null };
}
