import { expect, it } from 'vitest';
import agentList from '#/pages/agents/adapter/fixtures/agent-list.json';
import approvalList from '#/pages/agents/adapter/fixtures/approval-list.json';
import revoke from '#/pages/agents/adapter/fixtures/revoke.json';
import {
  readAgent,
  readAgentPage,
  readApprovalPage,
  revokeAgent,
} from '#/pages/agents/adapter/agents';
import type { GatewayResult } from '#/shared/api/transport/gateway';
import { fakeTransport, json } from '#/testing/fakeTransport';

const AGENTS = 'GET /console/api/admin/tenants/acme/agents';

function dataOf<T>(result: GatewayResult<T>): T | undefined {
  return result.ok ? result.data : undefined;
}

it('reads one page of runs with the cursor and filters it is given, and maps each', async () => {
  const fake = fakeTransport({ [AGENTS]: json(agentList) });
  const query = new URLSearchParams({ cursor: 'c1', state: 'live' });
  const page = dataOf(await readAgentPage(fake.transport.gateway, 'acme', query));
  expect(page?.next).toBe('c2');
  expect(page?.items[0]).toEqual({
    id: '0197a3b2-1c4d-7e5f-8a9b-0c1d2e3f4a5b',
    owner: '0197a3b1-aaaa-7bbb-8ccc-0d1e2f3a4b5c',
    agentClient: 'planner',
    parent: null,
    depth: 1,
    state: 'live',
    scope: 'mcp:read mcp:write',
    createdAt: '2026-11-25T08:00:00.000Z',
    expiresAt: '2026-11-25T08:15:00.000Z',
    revokedAt: null,
    budget: { mutating: 18, creates: 9 },
  });
  expect(page?.items[1]).toMatchObject({ parent: '0197a3b2-1c4d-7e5f-8a9b-0c1d2e3f4a5b' });
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual(['cursor=c1&state=live']);
});

it('refuses a run with a state the server does not name', async () => {
  const odd = { ...agentList.items[0], state: 'asleep' };
  const fake = fakeTransport({ [AGENTS]: json({ items: [odd] }) });
  expect(await readAgentPage(fake.transport.gateway, 'acme', new URLSearchParams())).toMatchObject({
    ok: false,
    kind: 'schema',
  });
});

it('reads one run by its id', async () => {
  const [run] = agentList.items;
  const fake = fakeTransport({ [`${AGENTS}/${run?.id ?? ''}`]: json(run) });
  const read = dataOf(await readAgent(fake.transport.gateway, 'acme', run?.id ?? ''));
  expect(read).toMatchObject({ agentClient: 'planner', depth: 1 });
});

it('reads the approvals and carries nothing of the digest the server never sends', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/agent-approvals': json(approvalList),
  });
  const page = dataOf(
    await readApprovalPage(
      fake.transport.gateway,
      'acme',
      new URLSearchParams({ state: 'approved' }),
    ),
  );
  expect(page?.items).toEqual([
    {
      id: '0197a3b3-0000-7000-8000-000000000001',
      owner: '0197a3b1-aaaa-7bbb-8ccc-0d1e2f3a4b5c',
      agentClient: 'planner',
      instance: null,
      kind: 'tool_call',
      summary: 'Delete the client reports',
      state: 'approved',
      createdAt: '2026-11-25T08:00:00.000Z',
      expiresAt: '2026-11-25T08:10:00.000Z',
      decidedAt: '2026-11-25T08:01:00.000Z',
      decidedVia: 'ciba_page',
    },
  ]);
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual(['state=approved']);
});

it('counts a revoke with dry_run, and ends it without', async () => {
  const fake = fakeTransport({
    'DELETE /console/api/admin/tenants/acme/agents/run%201': json(revoke),
  });
  expect(dataOf(await revokeAgent(fake.transport.gateway, 'acme', 'run 1', true))).toEqual({
    grants: 2,
    instances: 3,
  });
  expect(dataOf(await revokeAgent(fake.transport.gateway, 'acme', 'run 1', false))).toEqual({
    grants: 2,
    instances: 3,
  });
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual(['dry_run=true', '']);
});
