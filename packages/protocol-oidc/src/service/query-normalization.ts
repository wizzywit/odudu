// Fastify's default querystring parser returns a string[] for a repeated
// key, not the single string the rest of /authorize is typed and tested
// against. Normalizing here — before validateAuthorizationRequest's
// ordering logic runs — is what makes that type true at runtime instead of
// merely declared.
//
// The input is `unknown` rather than a parameter bag because it is whatever
// a body parser handed back: an absent POST body is `undefined`, and a
// parser that can produce numbers, objects or nulls (JSON) would otherwise
// smuggle them into rules written for strings — `code_challenge.length` on
// a number is `undefined`, which is not a rejection. Every value that is
// not a string is therefore treated as absent.
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

// An array of parameter values, or undefined when the key carries no string
// value at all. A single string reads as one value; anything else — number,
// object, null, an array once its non-string entries are discarded — is the
// parameter not being present.
function stringValues(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string');
  return strings.length === 0 ? undefined : strings;
}

export function normalizeAuthorizeQuery(raw: unknown): QueryNormalization {
  const params: Record<string, string | undefined> = {};
  let repeatedKey: string | null = null;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { kind: 'ok', params, repeatedKey };
  }

  for (const [key, rawValue] of Object.entries(raw)) {
    const values = stringValues(rawValue);
    if (values === undefined) continue;

    const [first, ...rest] = values;
    if (rest.length === 0) {
      params[key] = first;
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
    params[key] = first;
  }

  return { kind: 'ok', params, repeatedKey };
}
