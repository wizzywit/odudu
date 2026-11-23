import type { Deps, SignInOptions } from '@odudu-io/oidc';
import type { BrowserMode, SignInChoices } from '#/types';

export function signInOptions(mode: BrowserMode, choices: SignInChoices): SignInOptions {
  return {
    issuer: mode.issuer,
    clientId: mode.clientId,
    redirectUri: mode.redirectUri,
    scope: mode.scope,
    ...choices,
  };
}

export function hasChoices(choices: SignInChoices | undefined): boolean {
  return choices !== undefined && Object.keys(choices).length > 0;
}

export function depsOf(mode: BrowserMode): Deps {
  return mode.allowInsecureRequests === true ? { allowInsecureRequests: true } : {};
}
