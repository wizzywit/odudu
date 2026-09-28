export const SESSION_ENDED_TYPE = 'about:blank#console-session-ended';

// The gateway's own 401 for a console session that is over, as against the
// admin API's, which is passed through as it stands.
export function isSessionEnded(problem: {
  readonly status: number;
  readonly type: string;
}): boolean {
  return problem.status === 401 && problem.type === SESSION_ENDED_TYPE;
}
