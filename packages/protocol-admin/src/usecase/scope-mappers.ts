import { type ScopeMappers } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { clientScopeMapperRepository, clientScopeRepository } from '@odudu/domain-tenant';

// The one fragment of `ClaimMapperRegistry<Ctx>` (@odudu/kernel) this
// package needs — a name lookup with no claim context in it — so this
// usecase depends on that shape rather than on `@odudu/protocol-oidc`'s own
// `ClaimContext`, which a protocol package may never import (protocol
// packages never import each other). The composition root
// (apps/server/src/app.ts) passes its one real `ClaimMapperRegistry`
// instance, unchanged, as this.
export interface MapperCatalogue {
  mapperNames(): readonly string[];
}

export interface ScopeMapperAuditEvent {
  readonly action: 'scope.mappers_set';
  readonly resourceType: 'scope';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same no-op-until-a-real-sink seam. */
export type Audit = (event: ScopeMapperAuditEvent) => Promise<void>;

export type ReadScopeMappersOutcome = { kind: 'not_found' } | { kind: 'ok'; mappers: ScopeMappers };

export async function readScopeMappers(
  tx: TenantScopedDatabase,
  claimMappers: MapperCatalogue,
  scopeId: string,
): Promise<ReadScopeMappersOutcome> {
  const scope = await clientScopeRepository(tx).byId(scopeId);
  if (scope === null) return { kind: 'not_found' };

  const bound = await clientScopeMapperRepository(tx).namesForScope(scopeId);
  return {
    kind: 'ok',
    mappers: {
      available: [...claimMappers.mapperNames()],
      bound: bound === null ? [] : [...bound],
    },
  };
}

export interface SetScopeMappersInput {
  readonly scopeId: string;
  readonly mapperNames: readonly string[];
  readonly actorSubjectId: string;
}

export interface SetScopeMappersDeps {
  readonly audit: Audit;
}

export type SetScopeMappersOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_mapper'; names: readonly string[]; known: readonly string[] }
  | { kind: 'ok'; mappers: ScopeMappers };

export async function setScopeMappers(
  tx: TenantScopedDatabase,
  claimMappers: MapperCatalogue,
  deps: SetScopeMappersDeps,
  input: SetScopeMappersInput,
): Promise<SetScopeMappersOutcome> {
  const scope = await clientScopeRepository(tx).byId(input.scopeId);
  if (scope === null) return { kind: 'not_found' };

  const known = new Set(claimMappers.mapperNames());
  const unknown = [...new Set(input.mapperNames)].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    return { kind: 'unknown_mapper', names: unknown, known: [...known] };
  }

  await clientScopeMapperRepository(tx).replaceForScope(
    scope.tenantId,
    input.scopeId,
    input.mapperNames,
  );

  await deps.audit({
    action: 'scope.mappers_set',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
  });

  const bound = await clientScopeMapperRepository(tx).namesForScope(input.scopeId);
  return {
    kind: 'ok',
    mappers: {
      available: [...claimMappers.mapperNames()],
      bound: bound === null ? [] : [...bound],
    },
  };
}
