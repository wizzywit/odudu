import type { CallableTool, ToolProblem } from '#/services/tool';
import type { BudgetKind } from '#/services/write-budget';

export interface ToolOutcome {
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly reason?:
    'insufficient_scope' | 'missing_capability' | 'timeout_outcome_unknown' | 'write_budget';
}

export function outcomeOf(problem: ToolProblem | null): ToolOutcome {
  if (problem === null) return { outcome: 'allowed' };
  if (problem.problemType === 'mcp:write_budget') {
    return { outcome: 'refused', reason: 'write_budget' };
  }
  if (problem.problemType === 'mcp:outcome_unknown') {
    return { outcome: 'failed', reason: 'timeout_outcome_unknown' };
  }
  if (problem.status !== 403) return { outcome: 'failed' };
  const scope =
    problem.problemType === 'mcp:insufficient_scope' ||
    /^insufficient_scope\b/u.test(problem.detail ?? '');
  return { outcome: 'refused', reason: scope ? 'insufficient_scope' : 'missing_capability' };
}

// A write that answers 4xx was refused before it changed anything, so what it
// reserved is given back; a timeout, a failure to reach the admin API or an
// answer too large to read may follow a change that was made.
export function changedNothing(problem: ToolProblem | null): boolean {
  return (
    problem !== null &&
    problem.problemType !== 'mcp:outcome_unknown' &&
    problem.status !== null &&
    problem.status >= 400 &&
    problem.status < 500
  );
}

// What a call spends, when it spends anything: a write whose arguments the
// schema accepts. One it refuses is never sent, so it costs nothing. A write
// that declares no budget has no place in one, so it is not made.
export function spendOf(tool: CallableTool, input: unknown): BudgetKind | 'undeclared' | undefined {
  if (tool.access !== 'write') return undefined;
  if (tool.spends === undefined) return 'undeclared';
  try {
    const parsed = tool.input.safeParse(input);
    if (!parsed.success) return undefined;
    return tool.createsWhen?.(parsed.data) === true ? 'create' : tool.spends;
  } catch {
    return undefined;
  }
}

// A write from a token known not to hold the write scope is refused before the
// budget is read.
export function lacksWriteScope(tool: CallableTool, holdsWrite: boolean | undefined): boolean {
  return tool.access === 'write' && holdsWrite === false;
}

// The place to give back once a call is over: the one reserved for a call that
// was admitted and then refused before it changed anything.
export function budgetToGiveBack(
  kind: BudgetKind | 'undeclared' | undefined,
  admitted: boolean,
  problem: ToolProblem | null,
): BudgetKind | undefined {
  if (kind === undefined || kind === 'undeclared' || !admitted) return undefined;
  return changedNothing(problem) ? kind : undefined;
}
