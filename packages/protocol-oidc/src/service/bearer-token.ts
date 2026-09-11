// RFC 6750 §2: the `Authorization` header is the only bearer token
// presentation method Odudu accepts. §2.3 (a token in the URI query string)
// is dropped along with the rest of what OAuth 2.1 removes — a token there
// ends up in browser history, `Referer` headers, and proxy and access logs.
// §2.2 (a form-encoded body parameter) is likewise never read: `/userinfo`
// only ever receives GET requests, so there is no body to read one from.
export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (authorizationHeader === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  const token = match?.[1];
  return token !== undefined && token.length > 0 ? token : undefined;
}
