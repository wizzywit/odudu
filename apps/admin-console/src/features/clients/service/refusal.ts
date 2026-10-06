import { writeRefusal } from '#/shared/service/capabilities';
import type { Problem } from '#/shared/service/result.ts';

export const CLIENT_CAPABILITY = 'manage-clients';

// What a write on a client refused by the ceiling, or the last-administrator
// guard, means; null for anything the section says in the server's own words.
export function clientRefusal(problem: Problem): string | null {
  return writeRefusal(problem, CLIENT_CAPABILITY);
}
