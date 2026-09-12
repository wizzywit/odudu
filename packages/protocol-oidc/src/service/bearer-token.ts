// RFC 6750 §2 defines three ways a client may present a bearer token. Odudu
// accepts two of them: the `Authorization` header (§2.1) and, on a POST, the
// form-encoded `access_token` body parameter (§2.2), which OIDC Core §5.3.1
// permits a UserInfo Request to use. §2.3 (a token in the URI query string)
// is dropped along with the rest of what OAuth 2.1 removes — a token there
// ends up in browser history, `Referer` headers, and proxy and access logs.
export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (authorizationHeader === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  const token = match?.[1];
  return token !== undefined && token.length > 0 ? token : undefined;
}

export type PresentedToken =
  | { kind: 'absent' }
  // RFC 6750 §2: a client uses no more than one method per request. Two
  // presentations can disagree, and a resource server that silently picks
  // one is choosing which of two claims about the caller to believe.
  | { kind: 'ambiguous' }
  | { kind: 'present'; token: string };

// The body arrives as `unknown` because that is what a body parser hands
// back; only a single non-empty string is a token. RFC 6749 §3.1 makes
// `access_token=` an omitted parameter rather than an empty credential.
//
// Own enumerable properties only, read through Object.entries: a client
// presents a credential by sending it, and anything reachable only through
// the object's prototype was put there by whatever built the object, not by
// the client. `'access_token' in body` would accept that as a presentation.
function formEncodedToken(body: unknown): PresentedToken {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { kind: 'absent' };

  const entry = Object.entries(body).find(([key]) => key === 'access_token');
  if (entry === undefined) return { kind: 'absent' };

  const value: unknown = entry[1];
  // A repeated `access_token` presents the token twice inside one method,
  // ambiguous for the same reason two methods are.
  if (Array.isArray(value)) return { kind: 'ambiguous' };
  if (typeof value !== 'string' || value.length === 0) return { kind: 'absent' };
  return { kind: 'present', token: value };
}

export function presentedBearerToken(
  authorizationHeader: string | undefined,
  body: unknown,
): PresentedToken {
  const header = extractBearerToken(authorizationHeader);
  const form = formEncodedToken(body);

  if (form.kind === 'ambiguous') return form;
  if (header !== undefined && form.kind === 'present') return { kind: 'ambiguous' };
  if (header !== undefined) return { kind: 'present', token: header };
  return form;
}
