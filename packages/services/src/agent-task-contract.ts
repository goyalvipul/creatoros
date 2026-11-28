import { z } from 'zod';

export const AGENT_EVENT = 'kemokem.task.requested';
export const AGENT_SUBSCRIBE = 'agents.subscribe';
export const AGENT_EXECUTE = 'agents.execute';
export const AGENT_SCHEMA_VERSION = 1 as const;

// Only capabilities with concrete admission and result validators are advertised.
// New task types must add both schemas, authorization, and a delivery handler.
export const agentTaskTypes = ['CONTENT_STRATEGY', 'SCRIPT_GENERATION', 'IMAGE_GENERATION'] as const;
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
export const agentTaskInput = z.discriminatedUnion('taskType', [strategy, script, image]);
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
export const agentTaskResult = z.discriminatedUnion('taskType', [strategyResult, scriptResult, imageResult]);
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
  return parsed;
}
export function agentEventPayload(requestId: string, taskType: AgentTaskInput['taskType'], createdAt: Date) {
  return { eventId: requestId, name: AGENT_EVENT, timestamp: createdAt.toISOString(),
    data: { requestId, taskType, schemaVersion: AGENT_SCHEMA_VERSION }, cursor: null };
}
