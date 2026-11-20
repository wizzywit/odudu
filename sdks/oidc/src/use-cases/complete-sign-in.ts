import { exchangeForTokens } from '#/repository/code-exchange';
import { readCallback } from '#/services/callback';
import { discover } from '#/use-cases/discover';
import type { Deps, Pending, TokenSet } from '#/types';

// Finishes a sign-in from the address Odudu redirected the person to: checks
// the state and the issuer, exchanges the code and validates the ID token.
export async function completeSignIn(
  callbackUrl: string,
  pending: Pending,
  deps: Deps = {},
): Promise<TokenSet> {
  const params = readCallback(callbackUrl, pending);
  return exchangeForTokens(await discover(pending.issuer, deps), params, pending, deps);
}
