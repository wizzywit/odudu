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

// Repeating one of these leaves no way to send an error back at all, so it
// is answered above the RFC 6749 §4.1.2.1 boundary: render, never redirect,
// exactly like an unknown client.
//
// client_id and redirect_uri leave nothing trustworthy to redirect *to* —
// no single client, or no single redirect target. response_mode is here for
// the other half of the same problem: it names *how* a response is to be
// delivered, and two of them name two ways, at most one of which this
// server implements. Resolving it to whichever value happened to be read
// first would answer `response_mode=query&response_mode=fragment` with a
// redirect carrying error parameters — a response in the `query` mode to a
// request that also asked for `fragment`, which is precisely what OIDC Core
// §3.1.2.6 requires a bare HTTP 400 for.
//
// Any other repeated parameter (state, scope, ...) does not affect what can
// be trusted or how a response can be delivered, so it is left for
// validateAuthorizationRequest to reject below the boundary, once a
// redirect_uri exists to send the error to.
const RENDER_ON_REPEAT = new Set(['client_id', 'redirect_uri', 'response_mode']);

// What a key resolves to. `ambiguous` is deliberately not "more than one
// string survived": a value this code cannot read — a number, an object,
// whatever a parser produced — is still a value the client sent, and a key
// carrying one alongside a string is exactly as untrustworthy as a key
// carrying two strings. Collapsing it to a lone string would let a repeated
// client_id or redirect_uri past the boundary that exists to stop it, and
// so would dropping a key whose every value was unreadable: two values
// nobody can read are still two values, and `absent` would hide the repeat
// rather than report it.
type ParameterValue =
  | { kind: 'absent' }
  | { kind: 'single'; value: string }
  // `value` is undefined when nothing sent under the key was a string; the
  // key is still reported as repeated, just with nothing to carry forward.
  | { kind: 'ambiguous'; value: string | undefined };

function parameterValue(raw: unknown): ParameterValue {
  const sent = Array.isArray(raw) ? raw : [raw];
  // RFC 6749 §3.1: a parameter sent without a value is treated as if it had
  // been omitted, so `scope=` defaults like an absent scope rather than
  // failing as an unknown one, and `state=` is not echoed back empty.
  const present = sent.filter((entry) => entry !== '');
  const value = present.find((entry): entry is string => typeof entry === 'string');

  if (present.length > 1) return { kind: 'ambiguous', value };
  // A lone value this code cannot read carries nothing and claims nothing;
  // it is the omitted parameter it is indistinguishable from.
  return value === undefined ? { kind: 'absent' } : { kind: 'single', value };
}

export function normalizeAuthorizeQuery(raw: unknown): QueryNormalization {
  const params: Record<string, string | undefined> = {};
  let repeatedKey: string | null = null;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { kind: 'ok', params, repeatedKey };
  }

  for (const [key, rawValue] of Object.entries(raw)) {
    const resolved = parameterValue(rawValue);
    if (resolved.kind === 'absent') continue;

    if (resolved.kind === 'single') {
      params[key] = resolved.value;
      continue;
    }

    if (RENDER_ON_REPEAT.has(key)) {
      return {
        kind: 'render',
        error: 'invalid_request',
        description: `Repeated ${key} parameter`,
      };
    }

    repeatedKey ??= key;
    if (resolved.value !== undefined) params[key] = resolved.value;
  }

  return { kind: 'ok', params, repeatedKey };
}
