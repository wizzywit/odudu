/** The browser request an in-process call is made on behalf of. */
export interface Caller {
  readonly ip: string;
  readonly requestId: string;
}

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
  readonly from: Caller;
}

/** What a refresh returns. It carries no ID token. */
export interface RefreshedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

// `refused`: the stored refresh token can never be used again, either
// because the answer was invalid_grant or because a 200 rotated it past
// reading. `failed` is anything else, and the stored token still stands.
export type RefreshOutcome =
  | { readonly kind: 'refreshed'; readonly tokens: RefreshedTokens }
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed' };

export type AdminMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface AdminCall {
  readonly method: AdminMethod;
  /** Path and query under `/admin/`, exactly as they are to be sent. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer | undefined;
  readonly from: Caller;
}

export interface AdminResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | number | readonly string[] | undefined>>;
  readonly body: Buffer;
}

// The server this gateway is a client of, reached in-process. `null` is
// any answer other than the one asked for; the caller refuses the sign-in
// without saying which.
export interface OduduPort {
  issuerOf(tenant: string, from: Caller): Promise<string | null>;
  keysOf(tenant: string, from: Caller): Promise<unknown>;
  exchangeCode(input: CodeExchange): Promise<TokenSet | null>;
  // RFC 7009: revoking the refresh token ends the whole grant behind it.
  revoke(tenant: string, refreshToken: string, from: Caller): Promise<void>;
  refresh(tenant: string, refreshToken: string, from: Caller): Promise<RefreshOutcome>;
  forward(call: AdminCall): Promise<AdminResponse>;
}
