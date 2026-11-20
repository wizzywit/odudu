import type { TokenSet } from '@odudu-io/oidc';
import { finishSignIn } from '#/repository/browser-session';
import { readSession } from '#/repository/bff-session';
import { asOduduError, signedIn, signedOut } from '#/services/auth-state';
import type { AuthState, BrowserMode, Mode } from '#/types';

export interface Restored {
  state: AuthState;
  tokens: TokenSet | undefined;
}

async function restoreBrowser(mode: BrowserMode): Promise<Restored> {
  const tokens = await finishSignIn(mode);
  if (tokens === undefined) return { state: signedOut(), tokens: undefined };
  return { state: signedIn(tokens.claims), tokens };
}

// What this page load starts from: the BFF's answer, or the end of a sign-in
// the page began before it was left. A failure is a person who is signed out
// and the reason, never an exception into the render.
export function restore(mode: Mode): Promise<Restored> {
  const restored =
    mode.kind === 'bff'
      ? readSession(mode.baseUrl).then((state) => ({ state, tokens: undefined }))
      : restoreBrowser(mode);
  return restored.catch((error: unknown) => ({
    state: signedOut(asOduduError(error)),
    tokens: undefined,
  }));
}
