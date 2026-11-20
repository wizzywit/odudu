import { StdioError } from '#/service/stdio-error';
import { holdsWrite, type TokenSet } from '#/service/token-set';

type Scope = 'mcp:read' | 'mcp:write';

// A run that allows writes neither reads nor keeps a sign-in: a write token is
// short-lived and never refreshable, so each lapse is a new sign-in that asks
// the person again.
export function readsStoredSignIn(scope: Scope): boolean {
  return scope === 'mcp:read';
}

// The refresh token to keep for a token just issued, if any: only for a
// read-only run, and never one that arrived with `mcp:write`, whatever the
// server sent with it.
export function keepsRefreshToken(scope: Scope, set: TokenSet): string | undefined {
  if (!readsStoredSignIn(scope) || holdsWrite(set)) return undefined;
  return set.refreshToken;
}

// The server says the grant behind the stored refresh token has ended, so it is
// forgotten; any other failure leaves it where it is.
export function endsStoredSignIn(error: unknown): boolean {
  return error instanceof StdioError && error.code === 'mcp_grant_ended';
}
