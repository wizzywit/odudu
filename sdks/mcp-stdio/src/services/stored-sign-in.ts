// What is kept between runs: the refresh token and the authorization server it
// was issued by. A token is only ever presented to the server it came from, so
// an address changed in a configuration cannot be handed a sign-in made elsewhere.
export interface StoredSignIn {
  readonly refreshToken: string;
  readonly issuer: string;
  readonly tokenEndpoint: string;
}

export function encodeStored(stored: StoredSignIn): string {
  return JSON.stringify({
    refreshToken: stored.refreshToken,
    issuer: stored.issuer,
    tokenEndpoint: stored.tokenEndpoint,
  });
}

export function decodeStored(text: string): StoredSignIn | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { refreshToken, issuer, tokenEndpoint } = parsed as Record<string, unknown>;
    if (
      typeof refreshToken !== 'string' ||
      refreshToken === '' ||
      typeof issuer !== 'string' ||
      typeof tokenEndpoint !== 'string'
    ) {
      return undefined;
    }
    return { refreshToken, issuer, tokenEndpoint };
  } catch {
    return undefined;
  }
}

export function storedMatches(
  stored: StoredSignIn,
  server: { readonly issuer: string; readonly tokenEndpoint: string },
): boolean {
  return stored.issuer === server.issuer && stored.tokenEndpoint === server.tokenEndpoint;
}

export interface StoredVerdict {
  // Present only for a sign-in made at this server.
  readonly refreshToken: string | undefined;
  // True when something is held that must not be used again: it was made for
  // another server, or it cannot be read.
  readonly forget: boolean;
}

// Of the sign-in kept in memory and the text kept in the store, which to present
// to `server`. The one in memory is what the store would not take, so it is the
// newer.
export function judgeStored(
  unsaved: StoredSignIn | undefined,
  text: string | null,
  server: { readonly issuer: string; readonly tokenEndpoint: string },
): StoredVerdict {
  const held = unsaved ?? (text === null ? undefined : decodeStored(text));
  if (held !== undefined && storedMatches(held, server)) {
    return { refreshToken: held.refreshToken, forget: false };
  }
  return { refreshToken: undefined, forget: held !== undefined || text !== null };
}
