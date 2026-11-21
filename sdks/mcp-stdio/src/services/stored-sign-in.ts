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
