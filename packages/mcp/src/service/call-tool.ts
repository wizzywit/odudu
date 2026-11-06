import {
  cleanText,
  PROBLEM_DETAIL_CAP,
  PROBLEM_TITLE_CAP,
  PROBLEM_TYPE_CAP,
} from '#/service/sanitize';
import {
  ToolProblem,
  type AdminResult,
  type RegisteredTool,
  type ToolResult,
} from '#/service/tool';

// A result a client is sent is bounded whatever the page held: it is text a
// model reads, and the admin API's own page size bounds rows, not bytes.
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

function errorResult(problem: ToolProblem): ToolResult {
  const error = {
    type: cleanText(problem.problemType, PROBLEM_TYPE_CAP),
    title: cleanText(problem.title, PROBLEM_TITLE_CAP),
    ...(problem.status === null ? {} : { status: problem.status }),
    ...(problem.detail === undefined
      ? {}
      : { detail: cleanText(problem.detail, PROBLEM_DETAIL_CAP) }),
  };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error }) }],
    structuredContent: { error },
  };
}

export async function callTool(
  tool: RegisteredTool,
  caller: Parameters<RegisteredTool['run']>[0],
  input: unknown,
): Promise<ToolResult> {
  try {
    const output = await tool.run(caller, input);
    const text = JSON.stringify(output);
    if (text.length > RESULT_CAP) {
      return errorResult(
        new ToolProblem('mcp:result_too_large', 'The result is too large to return', null),
      );
    }
    return { isError: false, content: [{ type: 'text', text }], structuredContent: output };
  } catch (error) {
    if (error instanceof ToolProblem) return errorResult(error);
    throw error;
  }
}
