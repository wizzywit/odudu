import { useEffect, useRef, useState } from 'react';
import type { TokenSet } from '@odudu-io/oidc';
import { navigateTo } from '#/repository/navigation';
import { endSession } from '#/repository/bff-session';
import { freshToken, signOutAddress, startSignIn } from '#/repository/browser-session';
import { restore, type Restored } from '#/repository/restore';
import { asOduduError, endsSession, LOADING, signedOut, withError } from '#/services/auth-state';
import { loginUrl } from '#/services/bff';
import { bffHasNoToken, bffSignInTakesNoChoices, notSignedIn } from '#/services/errors';
import { hasChoices } from '#/services/sign-in';
import type { AuthContextValue, AuthState, SignInChoices } from '#/types';
import type { Mode } from '#/types';

// Holds the session for an <OduduProvider>. `mode` is read once, when the
// provider mounts. In browser mode the tokens live in a ref in this closure,
// so they are in no storage and in no state a component can render.
export function useAuthController(mode: Mode): AuthContextValue {
  const [fixed] = useState(mode);
  const [state, setState] = useState<AuthState>(LOADING);
  const tokens = useRef<TokenSet | undefined>(undefined);
  const restoring = useRef<Promise<Restored> | undefined>(undefined);

  useEffect(() => {
    let current = true;
    // Restoring twice would spend a sign-in's one-time record: share the one
    // promise between the runs React's strict mode makes.
    const started = restoring.current ?? restore(fixed);
    restoring.current = started;
    started.then(
      (restored) => {
        if (!current) return;
        tokens.current = restored.tokens;
        setState(restored.state);
      },
      (error: unknown) => {
        if (current) setState(signedOut(asOduduError(error)));
      },
    );
    return () => {
      current = false;
    };
  }, [fixed]);

  const fail = (error: unknown): void => {
    setState((previous) => withError(previous, asOduduError(error)));
  };

  const sessionEnded = (): void => {
    tokens.current = undefined;
    setState(signedOut());
  };

  const signIn = (choices?: SignInChoices): void => {
    if (fixed.kind === 'bff') {
      if (hasChoices(choices)) throw bffSignInTakesNoChoices();
      navigateTo(loginUrl(fixed.baseUrl));
      return;
    }
    startSignIn(fixed, choices ?? {}).then(navigateTo, fail);
  };

  const signOut = (): void => {
    if (fixed.kind === 'bff') {
      endSession(fixed.baseUrl).then((redirectTo) => {
        sessionEnded();
        if (redirectTo !== undefined) navigateTo(redirectTo);
      }, fail);
      return;
    }
    const held = tokens.current;
    if (held === undefined) return;
    sessionEnded();
    signOutAddress(fixed, held).then(navigateTo, fail);
  };

  const accessToken = async (resource?: string): Promise<string> => {
    if (fixed.kind === 'bff') throw bffHasNoToken();
    const held = tokens.current;
    if (held === undefined) throw notSignedIn();
    try {
      const fresh = await freshToken(fixed, held, resource);
      tokens.current = fresh.tokens;
      return fresh.accessToken;
    } catch (error) {
      if (endsSession(error)) sessionEnded();
      throw error;
    }
  };

  return { mode: fixed, state, signIn, signOut, accessToken, sessionEnded };
}
