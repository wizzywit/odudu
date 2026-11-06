import { type ClientRecord } from '@odudu/domain-tenant';

export const CLIENT_CREDENTIALS_GRANT = 'client_credentials';

// A public client has no secret to sign in with, so never holds an account.
export function canHoldServiceAccount(type: ClientRecord['type']): boolean {
  return type === 'confidential';
}

// Whether a grant change could take an account away, known before the new
// grants are: any change to the grants of a client that can have one.
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

// A service account exists for the one grant that signs in as the client
// itself. A confidential client that never holds the grant, or lets it go,
// has nothing to sign in as.
export function needsServiceAccount(
  type: ClientRecord['type'],
  grantTypes: readonly string[],
): boolean {
  return type === 'confidential' && grantTypes.includes(CLIENT_CREDENTIALS_GRANT);
}

// An import of a backup made before accounts followed the grant can list
// roles for a confidential client without it; no account is made for them.
export function discardsServiceAccountRoles(
  type: ClientRecord['type'],
  grantTypes: readonly string[],
): boolean {
  return type === 'confidential' && !needsServiceAccount(type, grantTypes);
}
