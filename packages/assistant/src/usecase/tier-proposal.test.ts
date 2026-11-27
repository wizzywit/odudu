import { TOOLS, type ToolResult } from '@odudu/mcp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WRITE_PLANS } from '#/service/approval-card';
import { FAILED_DENIAL, HUMAN_ONLY_DENIAL } from '#/service/proposal-rules';
import type { TargetFacts } from '#/service/tier';
import { toolApprovalFor, type PolicyDeps, type TurnApprovals } from '#/usecase/tool-approval';

const TOOL = 'update_role_description';
const ROLE = '0192a0a0-0000-7000-8000-0000000000b1';
const READ: ToolResult = {
  isError: false,
  content: [],
  structuredContent: { data: { id: ROLE, name: 'auditors', description: 'Old' } },
};
const CALL = {
  toolName: TOOL,
  toolCallId: 'call-1',
  input: { id: ROLE, if_match: '"v1"', description: 'New' },
};
const NONE: TargetFacts = {
  adminReach: [],
  isOwner: false,
  isBuiltinClient: false,
  rootsConversationGrant: false,
};

// No tool above tier A exists yet, so the plan of an existing one is raised for
// the length of a test to reach the proposal's tier rules.
const plan = WRITE_PLANS[TOOL] as unknown as Record<string, unknown>;
const original = { ...plan };
function raiseToC(): void {
  plan.tier = 'C';
  plan.confirmWith = () => 'auditors';
}
afterEach(() => {
  for (const key of Object.keys(plan)) Reflect.deleteProperty(plan, key);
  Object.assign(plan, original);
});

function deps(facts?: PolicyDeps['facts']) {
  const open = vi.fn<TurnApprovals['open']>((call) =>
    Promise.resolve({
      kind: 'opened',
      card: {
        approval_id: 'ap-1',
        tool_call_id: call.toolCallId,
        tool: call.tool,
        ...call.body,
        expires_at: '2026-11-26T10:00:00.000Z',
      },
    }),
  );
  const approvals: TurnApprovals = {
    open,
    write: () => Promise.resolve({ kind: 'not_approved' }),
    proposed: () => undefined,
  };
  const policy: PolicyDeps = {
    mode: 'act',
    tools: TOOLS,
    read: () => Promise.resolve(READ),
    approvals,
    ...(facts === undefined ? {} : { facts }),
  };
  return { open, status: () => toolApprovalFor(policy)({ toolCall: CALL, messages: [] }) };
}

describe('the tier of a proposed change', () => {
  it('is A for a change that grants nothing, with no text to type and no facts read', async () => {
    const facts = vi.fn(() => Promise.resolve(NONE));
    const { open, status } = deps(facts);
    expect(await status()).toBe('user-approval');
    expect(open.mock.calls[0]?.[0].body).toMatchObject({ tier: 'A', confirm_with: null });
    expect(facts).not.toHaveBeenCalled();
  });

  it('is C with the text the server wrote when the target reaches nothing', async () => {
    raiseToC();
    const facts = vi.fn(() => Promise.resolve(NONE));
    const { open, status } = deps(facts);
    expect(await status()).toBe('user-approval');
    expect(open.mock.calls[0]?.[0].body).toMatchObject({ tier: 'C', confirm_with: 'auditors' });
    expect(facts).toHaveBeenCalledWith({ kind: 'role', id: ROLE, removes: false });
  });

  it('is human-only, and opens nothing, when the target reaches an administrator capability', async () => {
    raiseToC();
    const { open, status } = deps(() => Promise.resolve({ ...NONE, adminReach: ['view-audit'] }));
    expect(await status()).toEqual({ type: 'denied', reason: HUMAN_ONLY_DENIAL });
    expect(open).not.toHaveBeenCalled();
  });

  it('is not proposed at all when the server was given no way to read the facts', async () => {
    raiseToC();
    const { open, status } = deps();
    expect(await status()).toEqual({ type: 'denied', reason: FAILED_DENIAL });
    expect(open).not.toHaveBeenCalled();
  });
});
