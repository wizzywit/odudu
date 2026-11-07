import {
  cleanText,
  PROBLEM_DETAIL_CAP,
  PROBLEM_ERROR_TEXT_CAP,
  PROBLEM_ERRORS_MAX,
  PROBLEM_TITLE_CAP,
  PROBLEM_TYPE_CAP,
} from '#/service/sanitize';
import {
  ToolProblem,
  type AdminResult,
  type ProblemError,
  type RegisteredTool,
  type ToolResult,
} from '#/service/tool';

// A result a client is sent is bounded whatever the page held, in bytes of the
// JSON text: the admin API's own page size bounds rows, not their size.
export const RESULT_CAP = 256_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Only `type`, `title` and `detail` of a problem+json answer are read, and only
// when it is one; any other body is the server's to keep.
export function problemOf(result: AdminResult): ToolProblem {
  const body = result.body;
  if (isRecord(body) && typeof body.type === 'string' && typeof body.title === 'string') {
    return new ToolProblem(
      body.type,
      body.title,
      result.status,
      typeof body.detail === 'string' ? body.detail : undefined,
    );
  }
  return new ToolProblem(
    'mcp:admin_error',
    `The admin API answered ${String(result.status)}`,
    result.status,
  );
}

function errorEntry(entry: ProblemError) {
  const text = (value: string) => cleanText(value, PROBLEM_ERROR_TEXT_CAP);
  return {
    path: text(entry.path),
    message: text(entry.message),
    ...(entry.code === undefined ? {} : { code: text(entry.code) }),
    ...(entry.detail === undefined ? {} : { detail: text(entry.detail) }),
    ...(entry.line === undefined ? {} : { line: entry.line }),
    ...(entry.column === undefined ? {} : { column: entry.column }),
  };
}

export function errorResult(problem: ToolProblem): ToolResult {
  const error = {
    type: cleanText(problem.problemType, PROBLEM_TYPE_CAP),
    title: cleanText(problem.title, PROBLEM_TITLE_CAP),
    ...(problem.status === null ? {} : { status: problem.status }),
    ...(problem.detail === undefined
      ? {}
      : { detail: cleanText(problem.detail, PROBLEM_DETAIL_CAP) }),
    ...(problem.errors === undefined || problem.errors.length === 0
      ? {}
      : { errors: problem.errors.slice(0, PROBLEM_ERRORS_MAX).map(errorEntry) }),
  };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error }) }],
    structuredContent: { error },
  };
}

export interface ToolRun {
  readonly result: ToolResult;
  // The refusal behind an error result, for a reader that classifies it; the
  // result is all a client is ever sent.
  readonly problem: ToolProblem | null;
}

// A caller refuses an answer past the admin read cap before the tool can speak;
// the tool's own advice is added where that refusal has no detail of its own.
function withAdvice(problem: ToolProblem, tool: RegisteredTool): ToolProblem {
  if (
    problem.problemType !== 'mcp:result_too_large' ||
    problem.detail !== undefined ||
    tool.tooLargeDetail === undefined
  ) {
    return problem;
  }
  return new ToolProblem(problem.problemType, problem.title, problem.status, tool.tooLargeDetail);
}

// `callTool` with the problem it turned into an error result kept beside it.
export async function runTool(
  tool: RegisteredTool,
  caller: Parameters<RegisteredTool['run']>[0],
  input: unknown,
): Promise<ToolRun> {
  try {
    const output = await tool.run(caller, input);
    const text = JSON.stringify(output);
    if (Buffer.byteLength(text) > RESULT_CAP) {
      const problem = new ToolProblem(
        'mcp:result_too_large',
        'The result is too large to return',
        null,
        tool.tooLargeDetail ?? 'Ask for fewer rows with a smaller limit, or narrow the filters.',
      );
      return { result: errorResult(problem), problem };
    }
    return {
      result: { isError: false, content: [{ type: 'text', text }], structuredContent: output },
      problem: null,
    };
  } catch (error) {
    if (error instanceof ToolProblem) {
      const problem = withAdvice(error, tool);
      return { result: errorResult(problem), problem };
    }
    throw error;
  }
}

export async function callTool(
  tool: RegisteredTool,
  caller: Parameters<RegisteredTool['run']>[0],
  input: unknown,
): Promise<ToolResult> {
  return (await runTool(tool, caller, input)).result;
}
