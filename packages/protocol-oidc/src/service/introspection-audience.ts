// RFC 7662 §2.2 leaves "the caller" undefined beyond "a protected
// resource". A `/introspect` caller authenticates with a `client_id`, but a
// token's `aud` is built from RFC 8707 resource URIs
// (`client_oidc_config.audiences`) — a different namespace. Either
// identity entitles the caller to a description; see
// docs/protocols/rfc7662.md's reading note "The caller's identity" for
// why, and why this is its own type rather than a bare string.
export interface IntrospectionCaller {
  readonly clientId: string;
  readonly audiences: readonly string[];
}

export function audienceOf(aud: unknown): string[] {
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud) && aud.every((entry): entry is string => typeof entry === 'string')) {
    return aud;
  }
  return [];
}

// True when the caller is entitled to a description of this token: its own
// `client_id`, or any resource URI it is registered under, is named in the
// token's `aud`. See `IntrospectionCaller`'s doc comment for why the two
// identities are checked together.
export function callerIsAddressed(caller: IntrospectionCaller, aud: readonly string[]): boolean {
  const identities = [caller.clientId, ...caller.audiences];
  return identities.some((identity) => aud.includes(identity));
}
