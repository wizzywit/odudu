import { MAX_FLOW_STEPS, MAX_FLOWS_PER_TENANT } from '@odudu/authn-flows';
import { FLOW_LIMIT, FLOW_STEP_MAX } from '@odudu/contracts/admin';
import { expect, it } from 'vitest';

// The repository reads at most one cap and the route refuses past the other:
// were they to differ, a tenant could hold flows the list does not show.
it('names the same flow and step caps in the wire contract and in the flow table’s reads', () => {
  expect(FLOW_LIMIT).toBe(MAX_FLOWS_PER_TENANT);
  expect(FLOW_STEP_MAX).toBe(MAX_FLOW_STEPS);
});
