import type { AdminAccess } from '#/service/admin-access';

// Where a call gets its bearer: one per access, since a run that asked for
// `mcp:write` holds a token that reads too and a read-only run holds none that
// writes. A source refuses an access its token cannot make.
export interface TokenSource {
  bearer(access: AdminAccess): Promise<string>;
  // Drops the token held if it is still the one the server refused, so the next
  // call gets another; a refusal of an earlier token leaves its replacement.
  invalidate?(rejected: string): void;
}
