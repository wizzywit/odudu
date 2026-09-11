// Fastify's default querystring parser returns a string[] for a repeated
// key, not the single string the rest of /authorize is typed and tested
// against. Normalizing here — before validateAuthorizationRequest's
// ordering logic runs — is what makes that type true at runtime instead of
// merely declared.
export type QueryNormalization =
  | { kind: 'render'; error: string; description: string }
  | { kind: 'ok'; params: Record<string, string | undefined>; repeatedKey: string | null };

// A repeated client_id or redirect_uri leaves nothing trustworthy to
// redirect to — no single client, or no single redirect target — so it is
// treated as being above the RFC 6749 §4.1.2.1 boundary: render, never
// redirect, exactly like an unknown client. Any other repeated parameter
// (state, scope, ...) does not affect what can be trusted, so it is left
// for validateAuthorizationRequest to reject below the boundary, once a
// redirect_uri exists to send the error to.
const AMBIGUOUS_TRUST_KEYS = new Set(['client_id', 'redirect_uri']);

export function normalizeAuthorizeQuery(
  raw: Record<string, string | string[] | undefined>,
): QueryNormalization {
  const params: Record<string, string | undefined> = {};
  let repeatedKey: string | null = null;

  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) {
      params[key] = value;
      continue;
    }

    if (AMBIGUOUS_TRUST_KEYS.has(key)) {
      return {
        kind: 'render',
        error: 'invalid_request',
        description: `Repeated ${key} parameter`,
      };
    }

    repeatedKey ??= key;
    params[key] = value[0];
  }

  return { kind: 'ok', params, repeatedKey };
}
