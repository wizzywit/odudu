import { type ClientRecord } from '@odudu/domain-tenant';

export const CLIENT_CREDENTIALS_GRANT = 'client_credentials';

// A service account exists for the one grant that signs in as the client
// itself. A confidential client that never holds the grant, or lets it go,
// has nothing to sign in as.
// Whether a grant change could take an account away, known before the new
// grants are: any change to the grants of a client that has one.
export function mayRetireServiceAccount(hasAccount: boolean, grantsChanged: boolean): boolean {
  return hasAccount && grantsChanged;
}

// Whether the grants a client is left with take its account away.
export function retiresServiceAccount(
  hasAccount: boolean,
  grantsChanged: boolean,
  type: ClientRecord['type'],
  grantTypes: readonly string[],
): boolean {
  return (
    mayRetireServiceAccount(hasAccount, grantsChanged) && !needsServiceAccount(type, grantTypes)
  );
}

export function needsServiceAccount(
  type: ClientRecord['type'],
  grantTypes: readonly string[],
): boolean {
  return type === 'confidential' && grantTypes.includes(CLIENT_CREDENTIALS_GRANT);
}
