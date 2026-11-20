import type { IdTokenClaims, OduduError, SignInAction } from '@odudu-io/oidc';

export type Claims = IdTokenClaims;

// Tokens stay on a server; the page holds a cookie and asks the BFF who the
// person is. `baseUrl` is where the BFF's routes are mounted.
export interface BffMode {
  kind: 'bff';
  baseUrl: string;
}

// The page runs the authorization code flow with PKCE and keeps the tokens in
// memory. `allowInsecureRequests` is for a development issuer on http.
export interface BrowserMode {
  kind: 'browser';
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  postLogoutRedirectUri?: string;
  allowInsecureRequests?: boolean;
}

export type Mode = BffMode | BrowserMode;

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

// What a sign-in can ask for beyond the app's registration. A sign-in starts at
// the registration page or at a credential change, not both.
export type SignInChoices = {
  resource?: string[];
  meAccess?: 'read' | 'write';
} & ({ prompt?: 'create'; action?: never } | { prompt?: never; action?: SignInAction });

export interface AuthState {
  status: AuthStatus;
  claims: Claims | undefined;
  // Why the last sign-in, refresh or sign-out did not work.
  error: OduduError | undefined;
}

export interface AuthContextValue {
  mode: Mode;
  state: AuthState;
  signIn: (choices?: SignInChoices) => void;
  signOut: () => void;
  accessToken: (resource?: string) => Promise<string>;
  sessionEnded: () => void;
}

export interface Auth {
  status: AuthStatus;
  signIn: (choices?: SignInChoices) => void;
  signOut: () => void;
  error: OduduError | undefined;
}
