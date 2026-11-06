import { describe, expect, it } from 'vitest';
import { approveAllResult, ignoreAllResult, ignoreApprovals, sendApprovals } from './approve-all';

describe('approve all', () => {
  it('sends every reply and keeps going after one refusal', async () => {
    const sent: string[] = [];
    const result = await sendApprovals(
      [
        { id: 'a', text: ' Thanks ', label: 'Ada' },
        { id: 'b', text: '   ', label: 'Bea' },
        { id: 'c', text: 'Hello', label: 'Cy' },
      ],
      async (item) => {
        if (item.id === 'c') throw new Error('You already replied to this conversation.');
        sent.push(item.text);
      },
    );
    expect(sent).toEqual(['Thanks']);
    expect(result.sent).toBe(1);
    expect(result.failed).toEqual([
      'Bea: reply is empty',
      'Cy: You already replied to this conversation.',
    ]);
    expect(approveAllResult(result.sent, result.failed)).toBe(
      'Sent 1. 2 not sent. Bea: reply is empty Cy: You already replied to this conversation.',
    );
    expect(approveAllResult(2, [])).toBeNull();
  });

  it('ignores every waiting reply and keeps going after one failure', async () => {
    const closed: string[] = [];
    const result = await ignoreApprovals(
      [
        { id: 'a', label: 'Ada' },
        { id: 'b', label: 'Bea' },
      ],
      async (id) => {
        if (id === 'b') throw new Error('This approval is already SENT.');
        closed.push(id);
      },
    );
    expect(closed).toEqual(['a']);
    expect(result.ignored).toBe(1);
    expect(ignoreAllResult(result.ignored, result.failed)).toBe(
      'Ignored 1. 1 still waiting. Bea: This approval is already SENT.',
    );
    expect(ignoreAllResult(2, [])).toBeNull();
  });
});