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
