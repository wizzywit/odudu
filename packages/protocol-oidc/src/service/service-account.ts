import { type ClientRecord } from '@odudu/domain-tenant';

export const CLIENT_CREDENTIALS_GRANT = 'client_credentials';

// A service account exists for the one grant that signs in as the client
// itself. A confidential client that never holds the grant, or lets it go,
// has nothing to sign in as.
export function needsServiceAccount(
  type: ClientRecord['type'],
  grantTypes: readonly string[],
): boolean {
  return type === 'confidential' && grantTypes.includes(CLIENT_CREDENTIALS_GRANT);
}
