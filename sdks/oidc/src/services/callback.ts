import { fromServerError, OduduError } from '#/services/odudu-error';

// Reads an authorization response. The state and the issuer are compared
// before anything else in it is believed: a response that names the wrong
// issuer is the mix-up attack of RFC 9207, and that holds for an error
// response as much as for one carrying a code.
export function readCallback(
  callbackUrl: string,
  expected: { state: string; issuer: string },
): URLSearchParams {
  const params = new URL(callbackUrl).searchParams;
  const state = params.get('state');
  if (state === null) {
    throw new OduduError('invalid_state', 'the response carries no state');
  }
  if (state !== expected.state) {
    throw new OduduError('invalid_state', 'the response state is not the one this sign-in sent');
  }
  const issuer = params.get('iss');
  if (issuer === null) {
    throw new OduduError('invalid_issuer', 'the response carries no iss parameter (RFC 9207)');
  }
  if (issuer !== expected.issuer) {
    throw new OduduError('invalid_issuer', 'the response iss is not the issuer this sign-in used');
  }
  const error = params.get('error');
  if (error !== null) {
    throw fromServerError(
      error,
      params.get('error_description') ?? undefined,
      'the authorization server refused the request',
    );
  }
  if (!params.has('code')) {
    throw new OduduError('invalid_callback', 'the response carries no code');
  }
  return params;
}
