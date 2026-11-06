import type { AuthorizationServer } from '#/service/metadata';
import type { TokenSet } from '#/service/token-set';

// Where a refresh token is kept between runs, one per issuer (the instance and
// tenant), so two tenants never share. `get` is null where nothing is kept.
export interface CredentialStore {
  get(): Promise<string | null>;
  put(secret: string): Promise<void>;
  clear(): Promise<void>;
}

export interface LoopbackListener {
  // `http://127.0.0.1:<port>/`: the registered `http://127.0.0.1` matched on any
  // port (RFC 8252 §7.3), at the path the client registers.
  readonly redirectUri: string;
  // The query of the one request that answers the sign-in.
  readonly callback: Promise<URLSearchParams>;
  close(): Promise<void>;
}

// Asks the desktop to open an address; false when it could not.
export type OpenUrl = (url: string) => Promise<boolean>;

// The authorization server as a command-line client talks to it.
export interface OauthClient {
  discover(): Promise<AuthorizationServer>;
  redeemCode(
    server: AuthorizationServer,
    input: { code: string; verifier: string; redirectUri: string; resource: string },
  ): Promise<TokenSet>;
  refresh(
    server: AuthorizationServer,
    input: { refreshToken: string; scope: string; resource: string },
  ): Promise<TokenSet>;
  clientCredentials(
    server: AuthorizationServer,
    input: { clientId: string; assertion: string; scope: string; resource: string },
  ): Promise<TokenSet>;
}
