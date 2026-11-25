import { json, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { graceRoutes } from '#/testing/renderConsole';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';

export const AGENTS = `${ACME_ADMIN}/agents`;
export const AGENT_APPROVALS = `${ACME_ADMIN}/agent-approvals`;

export function agent(id: string, parent: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    owner: 'sub-ada',
    agent_client: 'planner',
    parent,
    depth: parent === null ? 1 : 2,
    state: 'live',
    scope: 'mcp:read mcp:write',
    created_at: '2026-11-25T08:00:00.000Z',
    expires_at: '2099-11-25T08:15:00.000Z',
    revoked_at: null,
    remaining_budget: { mutating: 18, creates: 9 },
    ...extra,
  };
}

export const RUN_ROOT = agent('run-root', null);
export const RUN_CHILD = agent('run-child', 'run-root', { agent_client: 'writer' });
export const RUN_OLD = agent('run-old', null, {
  agent_client: 'auditor',
  owner: 'sub-bob',
  state: 'revoked',
  revoked_at: '2026-11-25T08:05:00.000Z',
});

export function approval(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    owner: 'sub-ada',
    agent_client: 'planner',
    instance: 'run-root',
    kind: 'tool_call',
    summary: 'Delete the client reports',
    state: 'pending',
    created_at: '2026-11-25T08:00:00.000Z',
    expires_at: '2099-11-25T08:10:00.000Z',
    decided_at: null,
    decided_via: null,
    ...extra,
  };
}

export const APPROVAL_PENDING = approval('ap-1');
export const APPROVAL_DENIED = approval('ap-2', {
  summary: 'Rotate the signing key',
  state: 'denied',
  decided_at: '2026-11-25T08:01:00.000Z',
  decided_via: 'ciba_page',
  instance: null,
});

// grace of acme holding the capabilities given, with three runs and two approvals.
export function agentRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return graceRoutes(
    capabilities,
    {
      [`GET ${AGENTS}`]: json({ items: [RUN_ROOT, RUN_CHILD, RUN_OLD] }),
      [`GET ${AGENT_APPROVALS}`]: json({ items: [APPROVAL_PENDING, APPROVAL_DENIED] }),
    },
    extra,
  );
}
