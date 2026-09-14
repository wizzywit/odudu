import { type RealmScopedDatabase } from '@odudu/db';
import { clientScopeRepository, type NewClientScope } from '#/repository/client-scopes';

// A scope is a promise about claims, and discovery advertises every scope a
// realm defines. So a scope is seeded here only once a claim mapper can
// answer for it (packages/protocol-oidc/src/service/claims.ts): `address`,
// `phone`, `roles` and `groups` join this list in the change that registers
// their mappers, not before, or `scopes_supported` would name scopes that
// add nothing to a token.
const DEFAULT_SCOPES: readonly Omit<NewClientScope, 'realmId'>[] = [
  { name: 'openid' },
  { name: 'profile' },
  { name: 'email' },
];

// Published so a document asserting what a freshly seeded realm advertises
// can be checked against the list that actually seeds it (tests/docs/).
export const REALM_DEFAULT_SCOPE_NAMES: readonly string[] = DEFAULT_SCOPES.map(
  (scope) => scope.name,
);

const DEFAULT_SCOPE_NAMES: ReadonlySet<string> = new Set(REALM_DEFAULT_SCOPE_NAMES);

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

// A scope reaches a token only when the realm defines it *and* the client is
// assigned it, so a newly provisioned client starts with the realm's standard
// vocabulary and nothing else. A scope the realm gained afterwards — a
// resource server's own `reports:read`, say — is assigned deliberately.
export async function provisionClientDefaults(
  tx: RealmScopedDatabase,
  clientId: string,
): Promise<void> {
  const repository = clientScopeRepository(tx);
  const defined = await repository.allForRealm();
  for (const scope of defined) {
    if (DEFAULT_SCOPE_NAMES.has(scope.name)) {
      await repository.assign(clientId, scope.id, 'default');
    }
  }
}
