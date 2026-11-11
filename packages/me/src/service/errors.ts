// The body of a refused request, in the shape OAuth 2.0 errors have.
export interface MeError {
  readonly error: string;
  readonly error_description: string;
}

export function invalidRequest(description: string): MeError {
  return { error: 'invalid_request', error_description: description };
}

export function notFound(description: string): MeError {
  return { error: 'not_found', error_description: description };
}

export const AGENT_NOT_PERMITTED_MESSAGE =
  'A token issued to an agent may read this account and may not change it; the person makes the change themselves';

export function agentNotPermitted(): MeError {
  return { error: 'agent_not_permitted', error_description: AGENT_NOT_PERMITTED_MESSAGE };
}

// The first problem a body has, named by where it is.
export function invalidBody(issues: readonly { path: PropertyKey[]; message: string }[]): MeError {
  const first = issues[0];
  const where =
    first === undefined || first.path.length === 0 ? '' : `${first.path.map(String).join('.')}: `;
  return invalidRequest(`The request body is not valid: ${where}${first?.message ?? 'no detail'}`);
}
