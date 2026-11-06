// RFC 6749 §4.1.2.1 and §5.2, plus the OIDC Core §3.1.2.6 ones a sign-in can
// answer with. Only these ever reach a terminal: an `error` an unvalidated
// response holds is the sender's text, so anything else is "unrecognised".
const REGISTERED: ReadonlySet<string> = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
  'access_denied',
  'invalid_scope',
  'invalid_target',
  'server_error',
  'temporarily_unavailable',
  'interaction_required',
  'login_required',
  'consent_required',
  'account_selection_required',
]);

export function registeredErrorCode(value: unknown): string {
  return typeof value === 'string' && REGISTERED.has(value) ? value : 'unrecognised';
}
