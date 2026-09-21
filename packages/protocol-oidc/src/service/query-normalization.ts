// Fastify's querystring parser returns a string[] for a repeated key, not
// the single string the rest of /authorize is typed against; normalizing
// before validateAuthorizationRequest runs is what makes that type true at
// runtime. The input is `unknown` because it is whatever a body parser
// handed back — a parser that can produce numbers, objects or nulls would
// otherwise smuggle them into rules written for strings, where
// `code_challenge.length` is `undefined` rather than a rejection.
export type QueryNormalization =
  | { kind: 'render'; error: string; description: string }
  | { kind: 'ok'; params: Record<string, string | undefined>; repeatedKey: string | null };

// Repeating one of these leaves no way to send an error back at all — no
// single client, no single redirect target, or two delivery modes named at
// once — so it is answered above the RFC 6749 §4.1.2.1 boundary: render,
// never redirect, exactly like an unknown client. Every other repeated
// parameter is left for validateAuthorizationRequest to reject below the
// boundary. See docs/protocols/rfc6749.md, "Repeated parameters, and the
// four answered above the boundary".
const RENDER_ON_REPEAT = new Set(['client_id', 'redirect_uri', 'response_mode', 'response_type']);

// What a key resolves to. `ambiguous` is deliberately not "more than one
// string survived": an unreadable value counts towards the repeat, because
// two values nobody can read are still two values (see the reading note
// cited above).
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
    // `resource` has its own reader (authorization-request.ts's
    // resourceParam) and its own repeat rule — RFC 8707 §2 refuses two
    // values with invalid_target, not with this function's generic
    // invalid_request for an unrecognised repeat. Folding it into
    // `repeatedKey` here would answer it with the wrong error before
    // parseResource ever saw it.
    if (key === 'resource') continue;

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
