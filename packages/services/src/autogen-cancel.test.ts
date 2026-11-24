import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelAutogenClip } from './autogen';
import type { Ctx } from './types';

const orgId = '11111111-1111-4111-8111-111111111111';
const clipId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const workerId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';
const promptId = '66666666-6666-4666-8666-666666666666';
const otherPrompt = '77777777-7777-4777-8777-777777777777';

function context(rows: unknown[][]) {
  const execute = vi.fn();
  for (const next of rows) execute.mockResolvedValueOnce({ rows: next });
  return { ctx: { orgId, db: { execute } } as unknown as Ctx, execute };
}

afterEach(() => vi.unstubAllGlobals());

describe('AutoGen targeted cancellation', () => {
  it('cancels an unassigned waiting clip without contacting either GPU', async () => {
    const { ctx, execute } = context([
      [{ id: clipId, runId, status: 'WAITING', workerId: null, jobId: null }],
      [{ id: clipId }],
      [],
    ]);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(cancelAutogenClip(ctx, clipId)).resolves.toMatchObject({ cancelled: true, clipId });
    expect(fetcher).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('deletes only the selected queued ComfyUI prompt', async () => {
    const { ctx } = context([
      [{ id: clipId, runId, status: 'RUNNING', workerId, workerLabel: 'RTX 3060', jobId, promptId, jobStatus: 'RUNNING' }],
      [{ baseUrl: 'http://gpu3060:8188/' }],
      [{ id: clipId }],
      [],
      [],
    ]);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        queue_running: [[0, otherPrompt]], queue_pending: [[1, promptId]],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await cancelAutogenClip(ctx, clipId);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]![0])).toContain('/queue');
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ delete: [promptId] });
  });

  it('interrupts only the selected running prompt and never issues a global interrupt', async () => {
    const { ctx } = context([
      [{ id: clipId, runId, status: 'RUNNING', workerId, workerLabel: 'RTX 3090', jobId, promptId, jobStatus: 'RUNNING' }],
      [{ baseUrl: 'http://gpu3090:8188/' }],
      [{ id: clipId }],
      [],
      [],
    ]);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        queue_running: [[0, promptId]], queue_pending: [[1, otherPrompt]],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await cancelAutogenClip(ctx, clipId);
    expect(String(fetcher.mock.calls[1]![0])).toContain('/interrupt');
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ prompt_id: promptId });
  });

  it('refuses cancellation during the staging window rather than claiming success', async () => {
    const { ctx } = context([
      [{ id: clipId, runId, status: 'CLAIMED', workerId, workerLabel: 'RTX 3090', jobId: null, promptId: null }],
    ]);
    await expect(cancelAutogenClip(ctx, clipId)).rejects.toThrow('being submitted');
  });
});
