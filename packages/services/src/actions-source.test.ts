import { describe, expect, it } from 'vitest';
import { actionSourcePath } from './actions';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

describe('actionSourcePath', () => {
  it('opens the record the action was raised from', () => {
    expect(actionSourcePath({ id, sourceType: 'thread', sourceId: other })).toBe(
      `/collaborations/threads/${other}`,
    );
    expect(actionSourcePath({ id, sourceType: 'invoice', sourceId: other })).toBe(
      `/collaborations/invoices/${other}`,
    );
    expect(actionSourcePath({ id, sourceType: 'deal', sourceId: other })).toBe(
      `/collaborations/deals/${other}`,
    );
    expect(
      actionSourcePath({
        id,
        sourceType: 'deliverable',
        sourceId: other,
        deepLink: `/collaborations?deal=${id}`,
      }),
    ).toBe(`/collaborations/deals/${id}`);
    expect(actionSourcePath({ id, sourceType: 'publication', deepLink: `/publishing/${other}` })).toBe(
      `/publishing/${other}`,
    );
  });

  it('opens the action itself when there is no other record', () => {
    expect(actionSourcePath({ id, sourceType: 'manual' })).toBe(`/today?action=${id}`);
    expect(actionSourcePath({ id, sourceType: 'workspace-os' })).toBe(`/today?action=${id}`);
    expect(actionSourcePath({ id, sourceType: 'publication', deepLink: `/publishing?pub=${other}` })).toBe(
      '/publishing?tab=unmatched',
    );
  });
});
