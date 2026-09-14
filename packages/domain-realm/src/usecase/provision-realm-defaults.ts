import { type RealmScopedDatabase } from '@odudu/db';
import { clientScopeRepository, type NewClientScope } from '#/repository/client-scopes';

// The OIDC vocabulary every realm needs to issue standard-shaped tokens.
// `roles` and `groups` carry claims an access token or /userinfo response
// may show, but not the ID token, which reaches the browser and cannot have
// its disclosure limited by the client asking for less.
const DEFAULT_SCOPES: readonly Omit<NewClientScope, 'realmId'>[] = [
  { name: 'openid' },
  { name: 'profile' },
  { name: 'email' },
  { name: 'address' },
  { name: 'phone' },
  { name: 'roles', includeInIdToken: false },
  { name: 'groups', includeInIdToken: false },
];

// Called once per realm, at the point the realm itself is created — the
// bootstrap seed command and every test fixture that stands up a realm call
// this so that a realm is never left without a scope vocabulary.
export async function provisionRealmDefaults(
  tx: RealmScopedDatabase,
  realmId: string,
): Promise<void> {
  const repository = clientScopeRepository(tx);
  for (const scope of DEFAULT_SCOPES) {
    await repository.create({ realmId, ...scope });
  }
}
