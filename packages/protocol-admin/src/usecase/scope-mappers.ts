import { type ScopeMappers } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  clientScopeMapperRepository,
  clientScopeRepository,
  clientScopes,
} from '@odudu/domain-tenant';
import { eq } from 'drizzle-orm';
import { etagOf, requiredPrecondition } from '#/service/etag';

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
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: ScopeMapperAuditEvent) => Promise<void>;

export type ReadScopeMappersOutcome =
  { kind: 'not_found' } | { kind: 'ok'; mappers: ScopeMappers; etag: string };

// Sorted before it is hashed, never as it is sent: `namesForScope` imposes
// no order, so two reads of an unchanged binding set would otherwise
// disagree about the `ETag` they answer. `available` is the registry's
// own list and no part of what a caller is replacing.
function mappersEtag(mappers: ScopeMappers): string {
  return etagOf({ bound: [...mappers.bound].sort() });
}

export async function readScopeMappers(
  tx: TenantScopedDatabase,
  claimMappers: MapperCatalogue,
  scopeId: string,
): Promise<ReadScopeMappersOutcome> {
  const scope = await clientScopeRepository(tx).byId(scopeId);
  if (scope === null) return { kind: 'not_found' };

  const mappers: ScopeMappers = {
    available: [...claimMappers.mapperNames()],
    bound: [...((await clientScopeMapperRepository(tx).namesForScope(scopeId)) ?? [])],
  };
  return { kind: 'ok', mappers, etag: mappersEtag(mappers) };
}

export interface SetScopeMappersInput {
  readonly scopeId: string;
  readonly mapperNames: readonly string[];
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface SetScopeMappersDeps {
  readonly audit: Audit;
}

export type SetScopeMappersOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_mapper'; names: readonly string[]; known: readonly string[] }
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; mappers: ScopeMappers; etag: string };

export async function setScopeMappers(
  tx: TenantScopedDatabase,
  claimMappers: MapperCatalogue,
  deps: SetScopeMappersDeps,
  input: SetScopeMappersInput,
): Promise<SetScopeMappersOutcome> {
  // Locked for the same reason `setGroupRoles` (#/usecase/groups.ts) locks
  // its group: a mutex around `replaceForScope`'s delete-then-insert, and
  // what makes the `If-Match` comparison below describe the state this
  // write actually overwrites.
  const locked = await tx
    .select({ tenantId: clientScopes.tenantId })
    .from(clientScopes)
    .where(eq(clientScopes.id, input.scopeId))
    .for('update');
  const scope = locked[0];
  if (scope === undefined) return { kind: 'not_found' };

  const before = await readScopeMappers(tx, claimMappers, input.scopeId);
  if (before.kind !== 'ok') return { kind: 'not_found' };
  const precondition = requiredPrecondition(input.ifMatch, before.etag);
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }

  const known = new Set(claimMappers.mapperNames());
  // Deduplicated once, then used for both the validation and the insert
  // below — replaceForScope inserts one row per name against a
  // (tenant_id, client_scope_id, mapper_name) primary key, so a repeated
  // name in the request would otherwise collide on its own insert.
  const uniqueNames = [...new Set(input.mapperNames)];
  const unknown = uniqueNames.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    return { kind: 'unknown_mapper', names: unknown, known: [...known] };
  }

  await clientScopeMapperRepository(tx).replaceForScope(scope.tenantId, input.scopeId, uniqueNames);

  await deps.audit(tx, {
    action: 'scope.mappers_set',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const after = await readScopeMappers(tx, claimMappers, input.scopeId);
  if (after.kind !== 'ok') {
    throw new Error(`scope ${input.scopeId} not found immediately after its own mapper write`);
  }
  return { kind: 'ok', mappers: after.mappers, etag: after.etag };
}
