// Parameters an authorization response carries (RFC 6749 section 4.1.2, RFC 9207).
const CALLBACK_PARAMS = ['code', 'state', 'iss', 'error', 'error_description', 'error_uri'];

// What the issuer sends the person back with: a `state` and a `code` or an
// `error`. A page of the app that uses those names itself is taken for one.
export function isCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('state') && (params.has('code') || params.has('error'));
}

// The address to show once the redirect has been read: the same page, without
// what the issuer added.
export function withoutCallbackParams(href: string): string {
  const url = new URL(href);
  for (const name of CALLBACK_PARAMS) url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}
