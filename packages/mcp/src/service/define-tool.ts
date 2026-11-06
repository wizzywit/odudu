import { ZodError } from 'zod';
import { ToolProblem, type McpTool, type RegisteredTool, type ToolData } from '#/service/tool';

const UNEXPECTED = 'The admin API answered something this tool does not understand';

function invalidArguments(error: ZodError): ToolProblem {
  const detail = error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
    .join('; ');
  return new ToolProblem('mcp:invalid_arguments', 'The arguments are not valid', 400, detail);
}

// A tool as a client calls it: the arguments arrive untyped and are checked
// first, so nothing is sent to the admin API for a call the schema refuses,
// and what the tool answers is checked against its declared output last.
export function defineTool<I, O extends ToolData>(tool: McpTool<I, O>): RegisteredTool {
  return {
    ...tool,
    input: tool.input,
    output: tool.output,
    run: async (caller, raw) => {
      const parsed = tool.input.safeParse(raw);
      if (!parsed.success) throw invalidArguments(parsed.error);
      try {
        return tool.output.parse(await tool.run(caller, parsed.data));
      } catch (error) {
        if (error instanceof ZodError)
          throw new ToolProblem('mcp:unexpected_response', UNEXPECTED, null);
        throw error;
      }
    },
  };
}
