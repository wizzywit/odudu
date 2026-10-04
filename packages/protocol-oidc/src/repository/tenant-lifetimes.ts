import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';
import { type TokenLifetimes } from '#/service/client-token-ttl';

export interface TenantLifetimes extends TokenLifetimes {
  readonly authorizationCodeTtlSeconds: number;
}

// Read inside the issuing transaction, so a lifetime an administrator has
// just changed applies from the next issuance. `tenants` filters on `id`,
// and row-level security hides every tenant but the transaction's own.
export function tenantLifetimesRepository(tx: TenantScopedDatabase) {
  return {
    async byId(tenantId: string): Promise<TenantLifetimes> {
      const rows = await tx
        .select({
          accessTokenTtlSeconds: tenants.accessTokenTtlSeconds,
          idTokenTtlSeconds: tenants.idTokenTtlSeconds,
          refreshTokenTtlSeconds: tenants.refreshTokenTtlSeconds,
          authorizationCodeTtlSeconds: tenants.authorizationCodeTtlSeconds,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const row = rows[0];
      if (row === undefined) throw new Error(`tenant ${tenantId} is not visible here`);
      return row;
    },
  };
}
