import { describe, expect, it } from 'vitest';
import { memoryWriteBudget, type WriteBudget } from '#/services/write-budget';
import { ToolProblem, type CallableTool } from '#/services/tool';
import { respondingWith } from '#/testing/fake-caller';
import {
  callMcpTool,
  type CallMcpToolDeps,
  type RecordedToolCall,
} from '#/use-cases/call-mcp-tool';

const reading: CallableTool = {
  name: 'get_thing',
  routeKey: 'GET /admin/tenants/:tenant/things/:id',
  access: 'read',
  input: { safeParse: (data) => ({ success: true, data }) },
  run: () => Promise.resolve({ data: 1 }),
};

const writing: CallableTool = {
  ...reading,
  name: 'update_thing',
  routeKey: 'PATCH /admin/tenants/:tenant/things/:id',
  access: 'write',
  spends: 'mutating',
};

function deps(budget: WriteBudget = memoryWriteBudget(), overrides: Partial<CallMcpToolDeps> = {}) {
  const recorded: RecordedToolCall[] = [];
  const errors: string[] = [];
  const made: CallMcpToolDeps = {
    requestId: 'req-1',
    deadlineMs: 1_000,
    budget,
    record: (call) => {
      recorded.push(call);
      return Promise.resolve();
    },
    logger: { error: (_context, message) => errors.push(message) },
    ...overrides,
  };
  return { made, recorded, errors };
}

describe('one tool call, made for a client', () => {
  it('runs a read and records that it was allowed', async () => {
    const { made, recorded } = deps();
    const result = await callMcpTool(made, reading, respondingWith({}), {});
    expect(result.structuredContent).toEqual({ data: 1 });
    expect(recorded).toEqual([
      { tool: 'get_thing', route: 'GET /admin/tenants/:tenant/things/:id', outcome: 'allowed' },
    ]);
  });

  it('spends a place of the allowance on a write, and refuses one past it', async () => {
    const budget = memoryWriteBudget({ mutating: 1, creates: 0 });
    const { made } = deps(budget);
    expect((await callMcpTool(made, writing, respondingWith({}), {})).isError).toBe(false);
    const second = await callMcpTool(made, writing, respondingWith({}), {});
    expect(second.isError).toBe(true);
    expect(JSON.stringify(second.structuredContent)).toContain('mcp:write_budget');
  });

  it('gives the place back for a write the admin API refused with a 4xx', async () => {
    const budget = memoryWriteBudget({ mutating: 1, creates: 0 });
    const refusing: CallableTool = {
      ...writing,
      run: () => Promise.reject(new ToolProblem('t', 'No', 412)),
    };
    const { made } = deps(budget);
    await callMcpTool(made, refusing, respondingWith({}), {});
    expect(await budget.reserve('mutating')).toBe(true);
  });

  it('refuses a write at once for a token that cannot write', async () => {
    const { made, recorded } = deps(undefined, { holdsWrite: false });
    const result = await callMcpTool(made, writing, respondingWith({}), {});
    expect(JSON.stringify(result.structuredContent)).toContain('mcp:insufficient_scope');
    expect(recorded[0]).toMatchObject({ outcome: 'refused', reason: 'insufficient_scope' });
  });

  it('says the outcome of a write that ran out of time is not known', async () => {
    const slow: CallableTool = { ...writing, run: () => new Promise(() => undefined) };
    const { made, recorded } = deps(undefined, { deadlineMs: 10 });
    const result = await callMcpTool(made, slow, respondingWith({}), {});
    expect(JSON.stringify(result.structuredContent)).toContain('mcp:outcome_unknown');
    expect(recorded[0]).toMatchObject({ outcome: 'failed', reason: 'timeout_outcome_unknown' });
  });

  it('answers an unexpected failure as its correlation id and nothing of the error', async () => {
    const broken: CallableTool = {
      ...reading,
      run: () => Promise.reject(new Error('secret detail')),
    };
    const { made, errors } = deps();
    const result = await callMcpTool(made, broken, respondingWith({}), {});
    expect(JSON.stringify(result.structuredContent)).toContain('req-1');
    expect(JSON.stringify(result.structuredContent)).not.toContain('secret detail');
    expect(errors).toEqual(['tool failed']);
  });

  it('withholds the data of a call whose record could not be written', async () => {
    const { made } = deps(undefined, { record: () => Promise.reject(new Error('down')) });
    const result = await callMcpTool(made, reading, respondingWith({}), {});
    expect(JSON.stringify(result.structuredContent)).toContain('mcp:audit_unavailable');
  });
});
