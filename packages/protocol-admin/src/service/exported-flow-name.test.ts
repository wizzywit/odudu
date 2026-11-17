import { describe, expect, it } from 'vitest';
import { exportedFlowName } from '#/service/exported-flow-name';

const NAMES = new Map([['f1', 'staff']]);

describe('exportedFlowName', () => {
  it('names the flow, and gives null for a client that follows the default', () => {
    expect(exportedFlowName(NAMES, 'f1', 'c')).toBe('staff');
    expect(exportedFlowName(NAMES, null, 'c')).toBeNull();
  });

  it('throws on a flow the tenant does not hold, naming the client and the flow', () => {
    expect(() => exportedFlowName(NAMES, 'gone', 'billing')).toThrow(/billing.*gone/u);
  });
});
