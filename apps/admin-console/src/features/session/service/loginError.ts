// The query parameter the gateway's callback names an authorization error in.
export const LOGIN_ERROR = 'login_error';

const TRY_AGAIN = 'The tenant needs you to finish signing in on its own page. Try again.';

const REFUSED =
  "The tenant refused the console's sign-in request. Try again, and tell the tenant's operator if it keeps happening.";

// RFC 6749 §4.1.2.1's codes, and OpenID Connect Core §3.1.2.6's, in words.
const LOGIN_ERRORS: Readonly<Record<string, string>> = {
  access_denied: 'Sign-in was cancelled.',
  temporarily_unavailable: "The tenant's sign-in is unavailable just now. Try again shortly.",
  server_error: "The tenant's sign-in failed on its side. Try again.",
  login_required: TRY_AGAIN,
  interaction_required: TRY_AGAIN,
  consent_required: TRY_AGAIN,
  account_selection_required: TRY_AGAIN,
  invalid_request: REFUSED,
  invalid_request_uri: REFUSED,
  unauthorized_client: REFUSED,
  unsupported_response_type: REFUSED,
  invalid_scope: REFUSED,
};

export function loginErrorMessage(code: string): string {
  return Object.hasOwn(LOGIN_ERRORS, code)
    ? (LOGIN_ERRORS[code] ?? '')
    : 'Sign-in did not complete. Try again.';
}

export function loginNotice(code: string | null): string | null {
  return code === null ? null : loginErrorMessage(code);
}

export function switchFailedText(failed: string, signedInTo: string): string {
  return `The switch to another tenant did not complete: ${failed} You're still signed in to ${signedInTo}.`;
}

export const SIGN_OUT_FAILED = 'Could not sign out. Try again.';
