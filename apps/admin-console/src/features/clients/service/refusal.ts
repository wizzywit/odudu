import { writeRefusal } from '#/shared/service/capabilities';
import type { GatewayFailure, Problem } from '#/shared/service/result.ts';

export const CLIENT_CAPABILITY = 'manage-clients';

// What a write on a client refused by the ceiling, or the last-administrator
// guard, means; null for anything the section says in the server's own words.
export function clientRefusal(problem: Problem): string | null {
  return writeRefusal(problem, CLIENT_CAPABILITY);
}

const CEILING = "the client's service account holds what the caller does not";

// The server judged the client's service account beyond the caller, which the
// record the page was drawn from did not say: it is out of date, and is read again.
export function ceilingRefused(failure: GatewayFailure): boolean {
  return (
    failure.kind === 'problem' &&
    failure.problem.status === 403 &&
    (failure.problem.detail ?? '').startsWith(CEILING)
  );
}
