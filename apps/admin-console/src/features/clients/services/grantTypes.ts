import { CLIENT_GRANT_TYPES, type Client } from '@odudu/contracts/admin';

export const GRANT_LABELS: Readonly<Record<string, string>> = {
  authorization_code: 'Authorization code',
  refresh_token: 'Refresh token',
  client_credentials: 'Client credentials',
  'urn:ietf:params:oauth:grant-type:token-exchange': 'Token exchange',
};

const GRANT_NOTES: Readonly<Record<string, string>> = {
  authorization_code: 'Signs a person in through the browser.',
  refresh_token: 'Renews a sign-in without the person returning.',
  client_credentials: "The client acts as itself, through its service account's roles.",
  'urn:ietf:params:oauth:grant-type:token-exchange': 'Trades one token for another (RFC 8693).',
};

const NO_SECRET = 'A public client has no secret to authenticate with, so it cannot hold this.';

// One grant as a checklist draws it.
export interface GrantOption {
  id: string;
  label: string;
  description: string;
  unavailable: string | null;
}

export function grantOptions(client: Pick<Client, 'type' | 'grant_types'>): GrantOption[] {
  return CLIENT_GRANT_TYPES.map((id) => ({
    id,
    label: GRANT_LABELS[id] ?? id,
    description: GRANT_NOTES[id] ?? '',
    unavailable:
      id === 'client_credentials' && client.type === 'public' && !client.grant_types.includes(id)
        ? NO_SECRET
        : null,
  }));
}

export const GRANTS_RULE =
  'What the client may ask the token endpoint for. A client holding none can obtain no token.';

// Every grant but client credentials alone starts from a sign-in that
// returns to a redirect URI, so a client with none holds only that one.
export function grantsBlock(grants: readonly string[], redirectUris: number): string | undefined {
  const alone = grants.length === 1 && grants[0] === 'client_credentials';
  if (alone || redirectUris > 0) return undefined;
  return 'This client has no redirect URI, so it can hold only client credentials. Add a redirect URI under Redirects & origins first.';
}

export const CREDENTIALS_RULE =
  'The scopes a client credentials token may carry, such as reports:read: the names a resource server checks, not the OpenID scopes assigned under Scopes.';

export const CREDENTIALS_NOUN = 'scope names';
