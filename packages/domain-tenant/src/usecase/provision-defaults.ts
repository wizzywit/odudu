import { type TenantScopedDatabase } from '@odudu/db';
import {
  clientScopeRepository,
  type ClientScopeAssignment,
  type NewClientScope,
} from '#/repository/client-scopes';

interface DefaultScope {
  scope: Omit<NewClientScope, 'tenantId'>;
  // 'default' pre-approves a scope the way P1 always has; 'optional' is
  // what lets P3's consent screen tell a pre-approved scope from one the
  // user must see and approve separately. `offline_access` is the one
  // scope here where that distinction matters — a credential a logout
  // cannot end is not something to pre-approve silently.
  assignment: ClientScopeAssignment;
}

// A scope is a promise about claims, and discovery advertises every scope a
// tenant defines. So a scope is seeded here only once a claim mapper can
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

// Published so a document asserting what a freshly seeded tenant advertises
// can be checked against the list that actually seeds it (tests/docs/).
export const TENANT_DEFAULT_SCOPE_NAMES: readonly string[] = DEFAULT_SCOPES.map(
  (defaultScope) => defaultScope.scope.name,
);

// Called once per tenant, at the point the tenant itself is created — the
// bootstrap seed command and every test fixture that stands up a tenant call
// this so that a tenant is never left without a scope vocabulary.
export async function provisionTenantDefaults(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<void> {
  const repository = clientScopeRepository(tx);
  for (const { scope, assignment } of DEFAULT_SCOPES) {
    await repository.create({ tenantId, ...scope, defaultClientAssignment: assignment });
  }
}

// A scope reaches a token only when the tenant defines it *and* the client is
// assigned it, so a newly provisioned client starts with the scopes its
// tenant marks with a `defaultClientAssignment` and nothing else — the
// standard vocabulary above until an administrator changes the marks. The
// assignment kind travels with each scope: `resolveScope` grants an
// `'optional'` scope exactly like a `'default'` one, but the consent screen
// tells them apart.
export async function provisionClientDefaults(
  tx: TenantScopedDatabase,
  clientId: string,
): Promise<void> {
  const repository = clientScopeRepository(tx);
  for (const scope of await repository.allForTenant()) {
    if (scope.defaultClientAssignment !== null) {
      await repository.assign(clientId, scope.id, scope.defaultClientAssignment);
    }
  }
}
