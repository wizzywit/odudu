import { OduduError } from '@odudu-io/oidc';

export function missingProvider(): OduduError {
  return new OduduError('invalid_options', 'this hook must be used inside an <OduduProvider>');
}

export function bffHasNoToken(): OduduError {
  return new OduduError(
    'invalid_options',
    'useAccessToken is not available in bff mode: the browser holds no token. ' +
      'Call your APIs through the BFF proxy with useBffFetch instead',
  );
}

export function browserHasNoProxy(): OduduError {
  return new OduduError(
    'invalid_options',
    'useBffFetch is only available in bff mode; in browser mode use useAccessToken',
  );
}

export function bffSignInTakesNoChoices(): OduduError {
  return new OduduError(
    'invalid_options',
    'bff mode starts every sign-in at <baseUrl>/login and cannot carry sign-in options; ' +
      'configure the BFF instead',
  );
}

export function notSignedIn(): OduduError {
  return new OduduError('login_required', 'there is no signed-in person to get a token for');
}

export function audienceNotGranted(resource: string | undefined): OduduError {
  const named = resource ?? 'the issuer';
  return new OduduError(
    'audience_not_granted',
    `this sign-in carries no access token for ${named}; ` +
      'call signIn({ resource: [...] }) to ask for it',
  );
}

export function noPendingSignIn(): OduduError {
  return new OduduError(
    'invalid_state',
    'the sign-in this redirect answers is gone from this browser tab',
  );
}

export function logoutRefused(status: number): OduduError {
  return new OduduError(
    'request_failed',
    `the BFF refused the sign-out with status ${String(status)}`,
  );
}

export function navigationRefused(): OduduError {
  return new OduduError(
    'invalid_request',
    'the address to navigate to is not an http or https address, so it was not followed',
  );
}

export function sessionCheckFailed(status: number): OduduError {
  return new OduduError(
    'request_failed',
    `the BFF answered the session check with status ${String(status)}`,
    { errorDescription: String(status) },
  );
}
