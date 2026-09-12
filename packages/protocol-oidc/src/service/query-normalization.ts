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

// What a key resolves to: the value to use, and whether more than one value
// was sent under it. `ambiguous` is deliberately not "more than one string
// survived": a value this code cannot read — a number, an object, whatever
// a parser produced — is still a value the client sent, and a key carrying
// one alongside a string is exactly as untrustworthy as a key carrying two
// strings. Collapsing it to a lone string would let a repeated client_id or
// redirect_uri past the boundary that exists to stop it.
interface ParameterValue {
  value: string;
  ambiguous: boolean;
}

// Undefined when the key carries no usable value at all: no string among
// what was sent, or nothing left once empty values are discarded.
function parameterValue(raw: unknown): ParameterValue | undefined {
  const sent = Array.isArray(raw) ? raw : [raw];
  // RFC 6749 §3.1: a parameter sent without a value is treated as if it had
  // been omitted, so `scope=` defaults like an absent scope rather than
  // failing as an unknown one, and `state=` is not echoed back empty.
  const present = sent.filter((entry) => entry !== '');
  const value = present.find((entry): entry is string => typeof entry === 'string');
  if (value === undefined) return undefined;
  return { value, ambiguous: present.length > 1 };
}

export function normalizeAuthorizeQuery(raw: unknown): QueryNormalization {
  const params: Record<string, string | undefined> = {};
  let repeatedKey: string | null = null;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { kind: 'ok', params, repeatedKey };
  }

  for (const [key, rawValue] of Object.entries(raw)) {
    const resolved = parameterValue(rawValue);
    if (resolved === undefined) continue;

    if (!resolved.ambiguous) {
      params[key] = resolved.value;
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
    params[key] = resolved.value;
  }

  return { kind: 'ok', params, repeatedKey };
}
