import { MAX_ISSUERS } from '#/services/key-cache';

// The issuer list is compared with a token's `iss` as written, so a list that
// could never match, or that would trust a plain-text key fetch, is refused
// when the verifier is made rather than failing every request.
export function checkIssuers(issuers: readonly string[], allowInsecure: boolean): void {
  if (issuers.length === 0) throw new TypeError('createVerifier needs at least one issuer');
  if (issuers.length > MAX_ISSUERS) {
    throw new TypeError(`createVerifier takes at most ${String(MAX_ISSUERS)} issuers`);
  }
  for (const issuer of issuers) {
    if (issuer.endsWith('/')) {
      throw new TypeError(`the issuer ${issuer} has a trailing slash; write it as the server does`);
    }
    if (!allowInsecure && !issuer.startsWith('https://')) {
      throw new TypeError(
        `the issuer ${issuer} is not https; set allowInsecureIssuers for a development server`,
      );
    }
  }
}

// RFC 6749 §3.3: space-separated tokens of %x21 / %x23-5B / %x5D-7E. A scope
// lands in a `WWW-Authenticate` challenge, so one that could break a header or
// a quoted string is refused when the middleware or verifier is made.
const SCOPE = /^[\x21\x23-\x5B\x5D-\x7E]+(?: [\x21\x23-\x5B\x5D-\x7E]+)*$/u;

export function checkScope(scope: string, name: string): void {
  if (!SCOPE.test(scope)) {
    throw new TypeError(
      `${name} must be scope tokens (RFC 6749 section 3.3) separated by single spaces`,
    );
  }
}
