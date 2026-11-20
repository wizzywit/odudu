import type { AuthorizationServer, IDToken } from 'oauth4webapi';

export type ServerMetadata = AuthorizationServer;

// What the core needs from its surroundings. Every member has a default that
// works in a browser, in Node and on an edge runtime.
export interface Deps {
  fetch?: typeof fetch;
  // Milliseconds since the epoch.
  now?: () => number;
  // Lets an http issuer through; for a development server on localhost only.
  allowInsecureRequests?: boolean;
}

export type SignInAction =
  'update-password' | 'configure-totp' | 'configure-passkey' | 'generate-recovery-codes';

interface SignInBase {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  // APIs the access token is for (RFC 8707).
  resource?: string[];
  // Adds the me audience and the scope that reads (`me:read`) or also writes
  // (`me:write`) the person's own account.
  meAccess?: 'read' | 'write';
  // The signing algorithm the client is registered for ID tokens; RS256 when
  // omitted.
  idTokenAlg?: 'RS256' | 'ES256';
}

// A sign-in starts at the registration page or at a credential change, not both.
export type SignInOptions = SignInBase &
  ({ prompt?: 'create'; action?: never } | { prompt?: never; action?: SignInAction });

// Everything completeSignIn needs from beginSignIn. The caller keeps it for
// the length of the redirect (session storage, a cookie, a server session);
// it is plain JSON and holds the PKCE verifier, so it stays private to the
// person who is signing in.
export interface Pending {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  // The audiences the sign-in asked for; empty for the issuer's own.
  resources: string[];
  idTokenAlg: 'RS256' | 'ES256';
}

export interface AudienceToken {
  accessToken: string;
  // Milliseconds since the epoch.
  expiresAt: number;
  scope: string;
}

export type IdTokenClaims = IDToken;

export interface TokenSet {
  // Keyed by the audience (`resource`) the access token was issued for, and by
  // the issuer when the sign-in named none.
  byAudience: Record<string, AudienceToken>;
  idToken: string;
  refreshToken?: string;
  claims: IdTokenClaims;
}
