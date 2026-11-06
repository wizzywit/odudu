import { registeredErrorCode } from '#/service/error-code';

export interface CallbackExpectation {
  readonly state: string;
  readonly issuer: string;
  // `authorization_response_iss_parameter_supported` of the metadata.
  readonly issuerAdvertised: boolean;
}

export type CallbackVerdict =
  | { readonly kind: 'code'; readonly code: string }
  | {
      readonly kind: 'refused';
      readonly reason: 'issuer_mismatch' | 'issuer_missing' | 'state_mismatch' | 'no_code';
    }
  | {
      readonly kind: 'refused';
      readonly reason: 'provider_error';
      readonly error: string;
    };

// What the redirect to the loopback listener may be believed to say. RFC 9207
// §2.4 first: a response from another issuer is judged before anything in it is
// read, because its `error` and `code` are the attacker's. Nothing free-form is
// ever returned: an error is its registered code or "unrecognised".
export function checkCallback(
  params: URLSearchParams,
  expected: CallbackExpectation,
): CallbackVerdict {
  const issuers = params.getAll('iss');
  if (issuers.length > 1 || (issuers.length === 1 && issuers[0] !== expected.issuer)) {
    return { kind: 'refused', reason: 'issuer_mismatch' };
  }
  if (issuers.length === 0 && expected.issuerAdvertised) {
    return { kind: 'refused', reason: 'issuer_missing' };
  }
  const states = params.getAll('state');
  if (states.length !== 1 || states[0] !== expected.state) {
    return { kind: 'refused', reason: 'state_mismatch' };
  }
  const errors = params.getAll('error');
  if (errors.length > 0) {
    const [first] = errors;
    return {
      kind: 'refused',
      reason: 'provider_error',
      error: errors.length === 1 ? registeredErrorCode(first) : 'unrecognised',
    };
  }
  const codes = params.getAll('code');
  const [code] = codes;
  if (codes.length !== 1 || code === undefined || code === '') {
    return { kind: 'refused', reason: 'no_code' };
  }
  return { kind: 'code', code };
}
