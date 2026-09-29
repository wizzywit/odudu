export const SESSION_ENDED_TYPE = 'about:blank#console-session-ended';

// The gateway's own 401 for a console session that is over, as against the
// admin API's, which is passed through as it stands.
export function isSessionEnded(problem: {
  readonly status: number;
  readonly type: string;
}): boolean {
  return problem.status === 401 && problem.type === SESSION_ENDED_TYPE;
}

export const PRINCIPAL_CHANGED_TYPE = 'about:blank#console-principal-changed';

// The gateway's 409 for a request naming a subject the session is not.
export function isPrincipalChanged(problem: {
  readonly status: number;
  readonly type: string;
}): boolean {
  return problem.status === 409 && problem.type === PRINCIPAL_CHANGED_TYPE;
}
