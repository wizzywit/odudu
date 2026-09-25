import { type TenantScopedDatabase } from '@odudu/db';
import { and, eq } from 'drizzle-orm';
import { clientScopeMappers } from '#/schema/client-scope-mappers';
import { clientScopes } from '#/schema/client-scopes';

export function clientScopeMapperRepository(tx: TenantScopedDatabase) {
  return {
    // null (never an empty array) distinguishes "no binding rows for this
    // scope" — where a mapper's own declared scopes apply — from an
    // explicit binding an operator wrote.
    async namesForScope(scopeId: string): Promise<readonly string[] | null> {
      const rows = await tx
        .select({ mapperName: clientScopeMappers.mapperName })
        .from(clientScopeMappers)
        .where(eq(clientScopeMappers.clientScopeId, scopeId));
      return rows.length === 0 ? null : rows.map((row) => row.mapperName);
    },

    // One query for the whole tenant, keyed by scope name rather than the
    // scope's surrogate id: what `assemble` and `claimNamesForScopes` key
    // their bindings map by, so no caller needs a second join to translate.
    async bindingsByScopeName(tenantId: string): Promise<ReadonlyMap<string, readonly string[]>> {
      const rows = await tx
        .select({ scopeName: clientScopes.name, mapperName: clientScopeMappers.mapperName })
        .from(clientScopeMappers)
        .innerJoin(clientScopes, eq(clientScopeMappers.clientScopeId, clientScopes.id))
        .where(eq(clientScopeMappers.tenantId, tenantId));

      const byName = new Map<string, string[]>();
      for (const row of rows) {
        const names = byName.get(row.scopeName) ?? [];
        names.push(row.mapperName);
        byName.set(row.scopeName, names);
      }
      return byName;
    },

    // Replaces the whole binding set for one scope — a mapper left out is
    // one the caller unbinds, the same replace-not-merge shape
    // `setScopeRoles` (@odudu/protocol-admin) uses for a role set.
    async replaceForScope(
      tenantId: string,
      scopeId: string,
      mapperNames: readonly string[],
    ): Promise<void> {
      await tx
        .delete(clientScopeMappers)
        .where(
          and(
            eq(clientScopeMappers.tenantId, tenantId),
            eq(clientScopeMappers.clientScopeId, scopeId),
          ),
        );
      if (mapperNames.length === 0) return;
      await tx
        .insert(clientScopeMappers)
        .values(
          mapperNames.map((mapperName) => ({ tenantId, clientScopeId: scopeId, mapperName })),
        );
    },
  };
}
