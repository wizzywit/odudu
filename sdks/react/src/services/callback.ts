// Parameters an authorization response carries (RFC 6749 section 4.1.2, RFC 9207).
const CALLBACK_PARAMS = ['code', 'state', 'iss', 'error', 'error_description', 'error_uri'];

// A redirect from the issuer answers a sign-in this tab began, which is
// recorded; a `code` or `error` in an address with no sign-in under way
// belongs to the app.
export function isCallback(search: string, signInUnderWay: boolean): boolean {
  const params = new URLSearchParams(search);
  return signInUnderWay && (params.has('code') || params.has('error'));
}

// The address to show once the redirect has been read: the same page, without
// what the issuer added.
export function withoutCallbackParams(href: string): string {
  const url = new URL(href);
  for (const name of CALLBACK_PARAMS) url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}
