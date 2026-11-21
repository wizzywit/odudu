import { describe, expect, it } from 'vitest';
import {
  budgetToGiveBack,
  changedNothing,
  lacksWriteScope,
  outcomeOf,
  spendOf,
} from '#/services/tool-call-rules';
import { ToolProblem, type CallableTool } from '#/services/tool';

const read: CallableTool = {
  name: 'get_thing',
  routeKey: 'GET /x',
  access: 'read',
  input: { safeParse: (data) => ({ success: true, data }) },
  run: () => Promise.resolve({ data: 1 }),
};
const write: CallableTool = { ...read, access: 'write', spends: 'mutating' };

describe('what an audit row says of a call', () => {
  it('is allowed when nothing went wrong', () => {
    expect(outcomeOf(null)).toEqual({ outcome: 'allowed' });
  });

  it.each([
    ['mcp:write_budget', 429, undefined, { outcome: 'refused', reason: 'write_budget' }],
    [
      'mcp:outcome_unknown',
      504,
      undefined,
      { outcome: 'failed', reason: 'timeout_outcome_unknown' },
    ],
    [
      'mcp:insufficient_scope',
      403,
      undefined,
      { outcome: 'refused', reason: 'insufficient_scope' },
    ],
    ['t', 403, 'insufficient_scope: x', { outcome: 'refused', reason: 'insufficient_scope' }],
    ['t', 403, 'not insufficient_scope', { outcome: 'refused', reason: 'missing_capability' }],
    ['t', 403, undefined, { outcome: 'refused', reason: 'missing_capability' }],
    ['t', 404, undefined, { outcome: 'failed' }],
    ['t', null, undefined, { outcome: 'failed' }],
  ] as const)('reads %s with status %s and detail %s', (type, status, detail, expected) => {
    expect(outcomeOf(new ToolProblem(type, 'x', status, detail))).toEqual(expected);
  });
});

describe('which failures changed nothing', () => {
  it('is a 4xx that is not an unknown outcome', () => {
    expect(changedNothing(new ToolProblem('t', 'x', 400))).toBe(true);
    expect(changedNothing(new ToolProblem('t', 'x', 499))).toBe(true);
    expect(changedNothing(new ToolProblem('mcp:outcome_unknown', 'x', 412))).toBe(false);
    expect(changedNothing(new ToolProblem('t', 'x', 399))).toBe(false);
    expect(changedNothing(new ToolProblem('t', 'x', 500))).toBe(false);
    expect(changedNothing(new ToolProblem('t', 'x', null))).toBe(false);
    expect(changedNothing(null)).toBe(false);
  });
});

describe('what a call spends', () => {
  it('is nothing for a read', () => {
    expect(spendOf(read, {})).toBeUndefined();
  });

  it('is undeclared for a write with no budget', () => {
    expect(spendOf({ ...read, access: 'write' }, {})).toBe('undeclared');
  });

  it('is nothing for arguments the schema refuses, or a schema that throws', () => {
    const refusing = { ...write, input: { safeParse: () => ({ success: false as const }) } };
    expect(spendOf(refusing as CallableTool, {})).toBeUndefined();
    const throwing = {
      ...write,
      input: {
        safeParse: (): never => {
          throw new Error('x');
        },
      },
    };
    expect(spendOf(throwing, {})).toBeUndefined();
  });

  it('is its budget, and a create when the arguments make it one', () => {
    expect(spendOf(write, {})).toBe('mutating');
    const creating: CallableTool = { ...write, createsWhen: (input) => input === 'new' };
    expect(spendOf(creating, 'new')).toBe('create');
    expect(spendOf(creating, 'old')).toBe('mutating');
  });
});

describe('a write without the write scope', () => {
  it('is only a write, from a token that is known not to hold the scope', () => {
    expect(lacksWriteScope(write, false)).toBe(true);
    expect(lacksWriteScope(write, true)).toBe(false);
    expect(lacksWriteScope(write, undefined)).toBe(false);
    expect(lacksWriteScope(read, false)).toBe(false);
  });
});

describe('the budget given back after a call', () => {
  const refused = new ToolProblem('t', 'x', 409);
  const unknown = new ToolProblem('mcp:outcome_unknown', 'x', 504);

  it('is the one reserved, for an admitted call the admin API refused with a 4xx', () => {
    expect(budgetToGiveBack('mutating', true, refused)).toBe('mutating');
    expect(budgetToGiveBack('create', true, refused)).toBe('create');
  });

  it('is nothing when nothing was reserved, the call was not admitted, or a change may have been made', () => {
    expect(budgetToGiveBack(undefined, true, refused)).toBeUndefined();
    expect(budgetToGiveBack('undeclared', true, refused)).toBeUndefined();
    expect(budgetToGiveBack('mutating', false, refused)).toBeUndefined();
    expect(budgetToGiveBack('mutating', true, unknown)).toBeUndefined();
    expect(budgetToGiveBack('mutating', true, null)).toBeUndefined();
  });
});
