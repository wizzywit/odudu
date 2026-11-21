import type { McpLogger } from '#/services/logger';
import { insufficientScopeProblem } from '#/services/admin-access';
import { errorResult, runTool, type ToolRun } from '#/services/call-tool';
import { ToolProblem, type AdminCaller, type CallableTool, type ToolResult } from '#/services/tool';
import {
  budgetToGiveBack,
  lacksWriteScope,
  outcomeOf,
  spendOf,
  type ToolOutcome,
} from '#/services/tool-call-rules';
import type { BudgetKind, WriteBudget } from '#/services/write-budget';

// What the audit trail holds of a tool call: which tool, which admin route it
// reached and how it ended. Never its arguments or its result, which can carry
// text an agent reads back.
export interface RecordedToolCall extends ToolOutcome {
  readonly tool: string;
  readonly route: string;
}

export interface CallMcpToolDeps {
  readonly requestId: string;
  // How long a tool may take before the call is answered without waiting any
  // longer. The admin call it made is not cancelled, so a write that is given
  // up on may still commit: its answer says the outcome is unknown.
  readonly deadlineMs: number;
  // The changes this token's grant may still make, shared by every call it makes.
  readonly budget: WriteBudget;
  // False for a token that does not hold the write scope: a write is then
  // refused before the budget is read, since nothing it could send would be
  // admitted and a refusal should cost no row lock. Left out where the caller
  // makes no such check.
  readonly holdsWrite?: boolean;
  record(call: RecordedToolCall): Promise<void>;
  readonly logger: Pick<McpLogger, 'error'>;
}

const OUTCOME_UNKNOWN =
  'The change may or may not have been made. Read the resource again with the matching get tool ' +
  'and compare it with what you meant to write before trying again.';

const BUDGET_SPENT =
  'This sign-in has made as many changes as it may. Nothing was changed by this call: tell the ' +
  'person, who can sign in again to give you a new allowance.';

const BUDGET_WAIT_MS = 5_000;

// Waits for the budget no longer than a slice of the tool's own deadline.
function within<T>(wait: Promise<T>): Promise<T | 'late'> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => {
      resolve('late');
    }, BUDGET_WAIT_MS);
  });
  return Promise.race([wait, late]).finally(() => {
    clearTimeout(timer);
  });
}

// Reserves the call's place in the grant's budget, or says why it has none. A
// budget that cannot be read in time is not guessed at: the call is not made,
// and a place that arrives after the wait ended is given back at once.
async function reserved(
  deps: CallMcpToolDeps,
  tool: CallableTool,
  kind: BudgetKind | 'undeclared',
): Promise<ToolProblem | null> {
  const unavailable = (detail: string): ToolProblem =>
    new ToolProblem(
      'mcp:write_budget_unavailable',
      'The call was not made because the allowance for changes could not be read',
      503,
      detail,
    );
  if (kind === 'undeclared') {
    deps.logger.error({ requestId: deps.requestId, tool: tool.name }, 'write tool has no budget');
    return unavailable(`Quote the correlation id ${deps.requestId} to the operator.`);
  }
  const asking = deps.budget.reserve(kind);
  try {
    const answer = await within(asking);
    if (answer === 'late') {
      asking.then(
        (admitted) => (admitted ? released(deps, tool, kind) : undefined),
        () => undefined,
      );
      deps.logger.error({ requestId: deps.requestId, tool: tool.name }, 'write budget too slow');
      return unavailable(`Quote the correlation id ${deps.requestId} to the operator.`);
    }
    return answer
      ? null
      : new ToolProblem('mcp:write_budget', 'Too many changes in this sign-in', 429, BUDGET_SPENT);
  } catch (error) {
    if (error instanceof ToolProblem) return error;
    deps.logger.error(
      { err: error, requestId: deps.requestId, tool: tool.name },
      'write budget not read',
    );
    return unavailable(`Quote the correlation id ${deps.requestId} to the operator.`);
  }
}

async function released(
  deps: CallMcpToolDeps,
  tool: CallableTool,
  kind: BudgetKind,
): Promise<void> {
  try {
    if ((await within(deps.budget.release(kind))) === 'late') {
      deps.logger.error(
        { requestId: deps.requestId, tool: tool.name },
        'write budget not given back in time',
      );
    }
  } catch (error) {
    deps.logger.error(
      { err: error, requestId: deps.requestId, tool: tool.name },
      'write budget not given back',
    );
  }
}

async function execute(
  deps: CallMcpToolDeps,
  tool: CallableTool,
  caller: AdminCaller,
  input: unknown,
): Promise<ToolRun> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new ToolProblem(
            'mcp:timeout',
            'The tool took too long and was given up on',
            504,
            undefined,
          ),
        );
      }, deps.deadlineMs);
    });
    return await Promise.race([runTool(tool, caller, input), deadline]);
  } catch (error) {
    let problem: ToolProblem;
    if (error instanceof ToolProblem && error.problemType === 'mcp:timeout') {
      deps.logger.error({ requestId: deps.requestId, tool: tool.name }, 'tool timed out');
      problem =
        tool.access === 'write'
          ? new ToolProblem(
              'mcp:outcome_unknown',
              'The tool took too long and whether the change was made is not known',
              504,
              OUTCOME_UNKNOWN,
            )
          : error;
    } else {
      deps.logger.error({ err: error, requestId: deps.requestId, tool: tool.name }, 'tool failed');
      problem = new ToolProblem(
        'mcp:internal_error',
        'Something went wrong on the server',
        500,
        `Quote the correlation id ${deps.requestId} to the operator.`,
      );
    }
    return { result: errorResult(problem), problem };
  } finally {
    clearTimeout(timer);
  }
}

// One tool call: the tool runs against the caller and exactly one row says it
// did, whether it succeeded, was refused or failed. A write first takes its
// place in the grant's budget, which is atomic in the database, so calls made
// at once cannot between them pass the limit. A call whose row cannot be
// written has its data withheld, because an access nobody can see was made is
// the one a trail exists to prevent. Anything unexpected is logged with its
// correlation id and answered as that id alone.
export async function callMcpTool(
  deps: CallMcpToolDeps,
  tool: CallableTool,
  caller: AdminCaller,
  input: unknown,
): Promise<ToolResult> {
  const kind = spendOf(tool, input);
  const unscoped = lacksWriteScope(tool, deps.holdsWrite) ? insufficientScopeProblem() : null;
  const refusal = unscoped ?? (kind === undefined ? null : await reserved(deps, tool, kind));
  const { result, problem } =
    refusal === null
      ? await execute(deps, tool, caller, input)
      : { result: errorResult(refusal), problem: refusal };
  const giveBack = budgetToGiveBack(kind, refusal === null, problem);
  if (giveBack !== undefined) await released(deps, tool, giveBack);
  try {
    await deps.record({ tool: tool.name, route: tool.routeKey, ...outcomeOf(problem) });
  } catch (error) {
    deps.logger.error(
      { err: error, requestId: deps.requestId, tool: tool.name },
      'tool call not recorded',
    );
    return errorResult(
      new ToolProblem(
        'mcp:audit_unavailable',
        'The call could not be recorded, so its result is withheld',
        503,
        `Quote the correlation id ${deps.requestId} to the operator.`,
      ),
    );
  }
  return result;
}
