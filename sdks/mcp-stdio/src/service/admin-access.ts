import { ToolProblem, type AdminMethod } from '#/service/tool';

export type AdminAccess = 'read' | 'write';

// A GET asks for a write token when `asWriter` says it is the first half of a
// write, so a token that may not write is refused before anything is read.
export function accessOf(method: AdminMethod, asWriter?: true): AdminAccess {
  return method === 'GET' && asWriter !== true ? 'read' : 'write';
}

export function insufficientScopeProblem(): ToolProblem {
  return new ToolProblem(
    'mcp:insufficient_scope',
    'The access token does not carry the scope this call needs',
    403,
  );
}
