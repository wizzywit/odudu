import { z } from 'zod';

// RFC 7523 §2.2's registered value for `client_assertion_type` when the
// assertion is a JWT, as OpenID Connect Core §9's `private_key_jwt` method
// requires.
export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

// The replay guard a later task builds has to remember every `jti` it has
// seen until that assertion's own `exp` passes. A ceiling here is what
// keeps that memory bounded regardless of what a client requests — an
// assertion valid for a year would have to be remembered for a year.
export const MAX_ASSERTION_LIFETIME_SECONDS = 300;

export interface ClientAssertionBody {
  readonly client_assertion?: unknown;
  readonly client_assertion_type?: unknown;
}

export interface ExpectedClientAssertion {
  readonly audience: string;
}

// Nothing in this result is authenticated. The assertion's signature is
// never checked here — the key is not known until the client is resolved,
// and resolving it may require a network fetch this function must not
// perform — so every field is what the assertion *claims*, not a verified
// fact. `claimedClientId` in particular is a client's own say-so; a later
// step checks that claim against that client's registered keys before
// anything here is trusted.
export type AssertionOutcome =
  | {
      readonly kind: 'ok';
      readonly claimedClientId: string;
      readonly jti: string;
      readonly expiresAt: Date;
    }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'invalid' };

// RFC 7523 §3's required claims this function can check without the key:
// `iss`/`sub` (compared to each other, not yet to a real client), `aud`,
// `exp` and `jti`. Each is refused rather than coerced — a `sub` that is a
// number or an `aud` that is an array fails the same way a missing field
// does, never gets converted into the shape this expects.
const clientAssertionClaims = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  aud: z.string().min(1),
  exp: z.number(),
  jti: z.string().min(1),
});

// Reads the middle segment of a `header.payload.signature` JWT without
// verifying the outer two. `undefined` covers every way that can fail — the
// wrong segment count, unpadded base64url that still decodes to garbage,
// or a payload that decodes but isn't JSON — so the caller has one branch
// to handle rather than one per failure mode.
function decodeAssertionPayload(assertion: string): unknown {
  const [header, payload, signature, ...rest] = assertion.split('.');
  if (
    header === undefined ||
    payload === undefined ||
    signature === undefined ||
    rest.length > 0 ||
    header.length === 0 ||
    payload.length === 0 ||
    signature.length === 0
  ) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export function parseClientAssertion(
  body: ClientAssertionBody,
  now: Date,
  expected: ExpectedClientAssertion,
): AssertionOutcome {
  if (body.client_assertion_type !== CLIENT_ASSERTION_TYPE) return { kind: 'unsupported' };
  if (typeof body.client_assertion !== 'string') return { kind: 'invalid' };

  const parsed = clientAssertionClaims.safeParse(decodeAssertionPayload(body.client_assertion));
  if (!parsed.success) return { kind: 'invalid' };
  const claims = parsed.data;

  // RFC 7523 §3: "the Issuer MUST contain the client_id of the OAuth
  // client" and "the Subject MUST be the client_id of the OAuth client" —
  // for a client authenticating as itself, the two name the same client.
  if (claims.iss !== claims.sub) return { kind: 'invalid' };
  if (claims.aud !== expected.audience) return { kind: 'invalid' };

  const nowSeconds = now.getTime() / 1000;
  if (claims.exp <= nowSeconds) return { kind: 'invalid' };
  if (claims.exp - nowSeconds > MAX_ASSERTION_LIFETIME_SECONDS) return { kind: 'invalid' };

  return {
    kind: 'ok',
    claimedClientId: claims.sub,
    jti: claims.jti,
    expiresAt: new Date(claims.exp * 1000),
  };
}
