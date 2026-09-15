import { type RealmScopedDatabase } from '@odudu/db';
import {
  clientScopeRepository,
  type ClientScopeAssignment,
  type NewClientScope,
} from '#/repository/client-scopes';

interface DefaultScope {
  scope: Omit<NewClientScope, 'realmId'>;
  // 'default' pre-approves a scope the way P1 always has; 'optional' is
  // what lets P3's consent screen tell a pre-approved scope from one the
  // user must see and approve separately. `offline_access` is the one
  // scope here where that distinction matters — a credential a logout
  // cannot end is not something to pre-approve silently.
  assignment: ClientScopeAssignment;
}

// A scope is a promise about claims, and discovery advertises every scope a
// realm defines. So a scope is seeded here only once a claim mapper can
// answer for it (packages/protocol-oidc/src/service/claims.ts). `roles`/
// `groups` default `includeInIdToken` false and `includeInAccessToken`
// true; the other five are the reverse — identity data for the browser,
// not a resource server named in `aud`. `offline_access` is the exception:
// it maps no claims, because it asks for a grant shape, not data — see
// docs/protocols/oidc-backchannel.md §2.7.
const DEFAULT_SCOPES: readonly DefaultScope[] = [
  { scope: { name: 'openid', includeInAccessToken: false }, assignment: 'default' },
  { scope: { name: 'profile', includeInAccessToken: false }, assignment: 'default' },
  { scope: { name: 'email', includeInAccessToken: false }, assignment: 'default' },
  { scope: { name: 'address', includeInAccessToken: false }, assignment: 'default' },
  { scope: { name: 'phone', includeInAccessToken: false }, assignment: 'default' },
  { scope: { name: 'roles', includeInIdToken: false }, assignment: 'default' },
  { scope: { name: 'groups', includeInIdToken: false }, assignment: 'default' },
  {
    scope: { name: 'offline_access', includeInAccessToken: false, includeInIdToken: false },
    assignment: 'optional',
  },
];

// Published so a document asserting what a freshly seeded realm advertises
// can be checked against the list that actually seeds it (tests/docs/).
export const REALM_DEFAULT_SCOPE_NAMES: readonly string[] = DEFAULT_SCOPES.map(
  (defaultScope) => defaultScope.scope.name,
);

const ASSIGNMENT_BY_DEFAULT_NAME: ReadonlyMap<string, ClientScopeAssignment> = new Map(
  DEFAULT_SCOPES.map((defaultScope) => [defaultScope.scope.name, defaultScope.assignment]),
);

// Called once per realm, at the point the realm itself is created — the
// bootstrap seed command and every test fixture that stands up a realm call
// this so that a realm is never left without a scope vocabulary.
export async function provisionRealmDefaults(
  tx: RealmScopedDatabase,
  realmId: string,
): Promise<void> {
  const repository = clientScopeRepository(tx);
  for (const { scope } of DEFAULT_SCOPES) {
    await repository.create({ realmId, ...scope });
  }
}

// A scope reaches a token only when the realm defines it *and* the client is
// assigned it, so a newly provisioned client starts with the realm's standard
// vocabulary and nothing else. A scope the realm gained afterwards — a
// resource server's own `reports:read`, say — is assigned deliberately. The
// assignment kind travels with each scope rather than being one blanket
// choice — `resolveScope` grants an `'optional'` scope exactly like a
// `'default'` one, but P3's consent screen will need to tell them apart.
export async function provisionClientDefaults(
  tx: RealmScopedDatabase,
  clientId: string,
): Promise<void> {
  const repository = clientScopeRepository(tx);
  const defined = await repository.allForRealm();
  for (const scope of defined) {
    const assignment = ASSIGNMENT_BY_DEFAULT_NAME.get(scope.name);
    if (assignment !== undefined) {
      await repository.assign(clientId, scope.id, assignment);
    }
  }
}
