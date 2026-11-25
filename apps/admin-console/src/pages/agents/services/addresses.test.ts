import { expect, it } from 'vitest';
import { agentApprovalsHref, agentsHref } from '#/pages/agents/services/addresses';

it('addresses the agents and their approvals under the tenant, encoding its name', () => {
  expect(agentsHref('acme')).toBe('/console/acme/agents');
  expect(agentApprovalsHref('a b')).toBe('/console/a%20b/agents/approvals');
});
