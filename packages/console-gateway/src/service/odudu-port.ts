/** What a code exchange returns, before any of it has been verified. */
export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string;
  readonly expiresInSeconds: number;
}

export interface CodeExchange {
  readonly tenant: string;
  readonly code: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly ip: string;
}

// The server this gateway is a client of, reached in-process. `null` is
// any answer other than the one asked for; the caller refuses the sign-in
// without saying which.
export interface OduduPort {
  issuerOf(tenant: string, ip: string): Promise<string | null>;
  keysOf(tenant: string, ip: string): Promise<unknown>;
  exchangeCode(input: CodeExchange): Promise<TokenSet | null>;
  // RFC 7009: revoking the refresh token ends the whole grant behind it.
  revoke(tenant: string, refreshToken: string, ip: string): Promise<void>;
}
