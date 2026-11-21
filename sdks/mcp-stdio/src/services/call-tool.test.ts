import { describe, expect, it } from 'vitest';
import { callTool, errorResult, problemOf, RESULT_CAP, runTool } from '#/services/call-tool';
import { ToolProblem, type CallableTool } from '#/services/tool';
import { respondingWith } from '#/testing/fake-caller';

function toolOf(run: CallableTool['run'], extra: Partial<CallableTool> = {}): CallableTool {
  return {
    name: 'probe',
    routeKey: 'GET /admin/tenants/:tenant/probe',
    access: 'read',
    input: { safeParse: (data) => ({ success: true, data }) },
    run,
    ...extra,
  };
}

describe('a tool call as a result a client is sent', () => {
  it('wraps what the tool answers as text and as structured content', async () => {
    const result = await callTool(
      toolOf(() => Promise.resolve({ data: 1 })),
      respondingWith({}),
      {},
    );
    expect(result).toEqual({
      isError: false,
      content: [{ type: 'text', text: '{"data":1}' }],
      structuredContent: { data: 1 },
    });
  });

  it('says a refusal as an error holding only its type, title, status and detail', async () => {
    const tool = toolOf(() => Promise.reject(new ToolProblem('t:x', 'Title\u0000', 409, 'why')));
    const run = await runTool(tool, respondingWith({}), {});
    expect(run.result.isError).toBe(true);
    expect(run.result.structuredContent).toEqual({
      error: { type: 't:x', title: 'Title', status: 409, detail: 'why' },
    });
    expect(run.problem?.status).toBe(409);
  });

  it('lets anything that is not a refusal through', async () => {
    const tool = toolOf(() => Promise.reject(new Error('boom')));
    await expect(runTool(tool, respondingWith({}), {})).rejects.toThrow('boom');
  });

  it('refuses a result past the cap, with the tool’s own advice and the etag of what it read', async () => {
    const huge = { data: 'x'.repeat(RESULT_CAP), etag: '"abc"' };
    const tool = toolOf(() => Promise.resolve(huge), { tooLargeDetail: 'Read it in the console.' });
    const run = await runTool(tool, respondingWith({}), {});
    expect(run.problem?.problemType).toBe('mcp:result_too_large');
    expect(run.result.structuredContent).toEqual({
      error: {
        type: 'mcp:result_too_large',
        title: 'The result is too large to return',
        detail: 'Read it in the console.',
      },
      etag: '"abc"',
    });
  });

  it('reads only the type, title and detail of a problem body', () => {
    const problem = problemOf({
      status: 409,
      headers: {},
      body: { type: 'about:blank', title: 'Conflict', detail: 'd', stack: 'secret' },
    });
    expect(problem).toMatchObject({ problemType: 'about:blank', status: 409, detail: 'd' });
    expect(problemOf({ status: 502, headers: {}, body: '<html>' }).problemType).toBe(
      'mcp:admin_error',
    );
  });

  it('lists at most ten fields at fault, each cut short', () => {
    const errors = Array.from({ length: 12 }, (_, i) => ({
      path: `f${String(i)}`,
      message: 'm'.repeat(500),
    }));
    const { structuredContent } = errorResult(new ToolProblem('t', 'T', 400, undefined, errors));
    const listed = (structuredContent.error as { errors: { message: string }[] }).errors;
    expect(listed).toHaveLength(10);
    expect(listed[0]?.message.length).toBeLessThanOrEqual(200);
  });
});
