import type { McpLogger } from '#/service/deps';
import { errorResult, runTool } from '#/service/call-tool';
import {
  ToolProblem,
  type AdminCaller,
  type RegisteredTool,
  type ToolResult,
} from '#/service/tool';

// What the audit trail holds of a tool call: which tool, which admin route it
// reached and how it ended. Never its arguments or its result, which can carry
// text an agent reads back.
export interface RecordedToolCall {
  readonly tool: string;
  readonly route: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly reason?: 'insufficient_scope' | 'missing_capability' | 'timeout_outcome_unknown';
}

export interface CallMcpToolDeps {
  readonly requestId: string;
  // How long a tool may take before the call is answered without waiting any
  // longer. The admin call it made is not cancelled, so a write that is given
  // up on may still commit: its answer says the outcome is unknown.
  readonly deadlineMs: number;
  record(call: RecordedToolCall): Promise<void>;
  readonly logger: Pick<McpLogger, 'error'>;
}

const OUTCOME_UNKNOWN =
  'The change may or may not have been made. Read the resource again with the matching get tool ' +
  'and compare it with what you meant to write before trying again.';

function outcomeOf(problem: ToolProblem | null): Pick<RecordedToolCall, 'outcome' | 'reason'> {
  if (problem === null) return { outcome: 'allowed' };
  if (problem.problemType === 'mcp:outcome_unknown') {
    return { outcome: 'failed', reason: 'timeout_outcome_unknown' };
  }
  if (problem.status !== 403) return { outcome: 'failed' };
  const scope =
    problem.problemType === 'mcp:insufficient_scope' ||
    /^insufficient_scope\b/u.test(problem.detail ?? '');
  return { outcome: 'refused', reason: scope ? 'insufficient_scope' : 'missing_capability' };
}

// One tool call: the tool runs against the caller and exactly one row says it
// did, whether it succeeded, was refused or failed. A call whose row cannot be
// written has its data withheld, because an access nobody can see was made is
// the one a trail exists to prevent. Anything unexpected is logged with its
// correlation id and answered as that id alone.
export async function callMcpTool(
  deps: CallMcpToolDeps,
  tool: RegisteredTool,
  caller: AdminCaller,
  input: unknown,
): Promise<ToolResult> {
  let result: ToolResult;
  let problem: ToolProblem | null;
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
    ({ result, problem } = await Promise.race([runTool(tool, caller, input), deadline]));
  } catch (error) {
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
      result = errorResult(problem);
    } else {
      deps.logger.error({ err: error, requestId: deps.requestId, tool: tool.name }, 'tool failed');
      problem = new ToolProblem(
        'mcp:internal_error',
        'Something went wrong on the server',
        500,
        `Quote the correlation id ${deps.requestId} to the operator.`,
      );
      result = errorResult(problem);
    }
  } finally {
    clearTimeout(timer);
  }
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
