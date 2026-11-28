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
