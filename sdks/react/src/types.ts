import type { IdTokenClaims, OduduError, SignInAction } from '@odudu-io/oidc';

export type Claims = IdTokenClaims;

// Tokens stay on a server; the page holds a cookie and asks the BFF who the
// person is. `baseUrl` is where the BFF's routes are mounted; `proxyPath` is
// where its proxy is, a path of this origin, `<baseUrl>/proxy` when omitted.
export interface BffMode {
  kind: 'bff';
  baseUrl: string;
  proxyPath?: string;
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

// Read once, when the <OduduProvider> mounts; changing it later has no effect.
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
  // Why the last session check, sign-in, refresh or sign-out did not work, for
  // the app to show. While it is set, <SignedOut> renders nothing, so a failed
  // check is never read as a person to sign in again. Only a 401 from the BFF
  // is a clean signed-out.
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
