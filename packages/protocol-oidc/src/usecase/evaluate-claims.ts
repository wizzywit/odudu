import { type TenantScopedDatabase } from '@odudu/db';
import { effectiveGroupPaths, effectiveRoles } from '@odudu/domain-authz';
import { subjectRepository, userRepository } from '@odudu/domain-identity';
import {
  clientRepository,
  clientScopeMapperRepository,
  clientScopeRepository,
} from '@odudu/domain-tenant';
import { type ClaimMapperRegistry } from '@odudu/kernel';
import { accessTokenEligibleScope, reachableRoleIds } from '#/repository/scope-role-reach';
import { type ClaimContext, type LoadedClaimContext } from '#/service/claims';
import { idTokenScopeOf, mappedClaims } from '#/service/issued-claims';
import { resolveScope } from '#/service/scope';

// Roles need a recursive CTE (effectiveRoles), which a claim mapper must
// never run itself — resolved here, once per issuance, alongside the user
// row, the subject's direct group memberships, and the tenant's own
// scope-mapper bindings. `bindings` travels beside `context`, never inside
// it, so nothing a mapper receives can read it.
export async function loadClaimContextIn(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
): Promise<LoadedClaimContext> {
  return {
    context: {
      subjectId,
      user: await userRepository(tx).bySubjectId(subjectId),
      roles: await effectiveRoles(tx, subjectId),
      groups: await effectiveGroupPaths(tx, subjectId),
    },
    bindings: await clientScopeMapperRepository(tx).bindingsByScopeName(tenantId),
  };
}

export interface EvaluateClaimsInput {
  readonly tenantId: string;
  readonly clientDbId: string;
  readonly subjectId: string;
  /** Space-separated, as a request carries it; absent, the client's default scopes. */
  readonly scope: string | undefined;
}

export type EvaluateClaimsOutcome =
  | { kind: 'client_not_found' }
  | { kind: 'subject_not_found' }
  | {
      kind: 'ok';
      scope: readonly string[];
      idToken: Record<string, unknown> | null;
      accessToken: Record<string, unknown>;
      userinfo: Record<string, unknown>;
    };

// What an authorization-code exchange for this client and subject would
// map into each artefact, through the functions that exchange and /userinfo
// call: the scope resolved against the client's assignments, roles narrowed
// to what it reaches, each artefact gated by its own scope flags. Mapped
// claims only — the envelope (`iss`, `aud`, `exp`, …) is the signer's.
export async function evaluateClaims(
  tx: TenantScopedDatabase,
  deps: { readonly claimMappers: ClaimMapperRegistry<ClaimContext> },
  input: EvaluateClaimsInput,
): Promise<EvaluateClaimsOutcome> {
  const client = await clientRepository(tx).byId(input.clientDbId);
  if (client === null) return { kind: 'client_not_found' };
  if ((await subjectRepository(tx).byId(input.subjectId)) === null) {
    return { kind: 'subject_not_found' };
  }

  const assigned = await clientScopeRepository(tx).forClient(client.id);
  const requested =
    input.scope ??
    (await clientScopeRepository(tx).forClientByAssignment(client.id))
      .filter((entry) => entry.assignment === 'default')
      .map((entry) => entry.scope.name)
      .join(' ');
  const scope = resolveScope(
    requested,
    assigned.map((clientScope) => clientScope.name),
    null,
    null,
  );
  const loaded = await loadClaimContextIn(tx, input.tenantId, input.subjectId);
  const reach = {
    reachableRoleIds: await reachableRoleIds(tx, scope),
    fullScopeAllowed: client.fullScopeAllowed,
  };
  return {
    kind: 'ok',
    scope,
    idToken: scope.includes('openid')
      ? await mappedClaims(deps.claimMappers, idTokenScopeOf(assigned, scope), loaded, reach)
      : null,
    accessToken: await mappedClaims(
      deps.claimMappers,
      await accessTokenEligibleScope(tx, scope),
      loaded,
      reach,
    ),
    userinfo: await mappedClaims(deps.claimMappers, scope, loaded, reach),
  };
}
