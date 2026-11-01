import { type TenantScopedDatabase } from '@odudu/db';
import { tenantSettingsRepository } from '@odudu/domain-tenant';

/** The languages a tenant offers, read for a write that carries per-language text. */
export async function tenantLanguages(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<readonly string[]> {
  const list: unknown = (await tenantSettingsRepository(tx).byId(tenantId))?.supported_locales;
  return Array.isArray(list) ? list.filter((tag): tag is string => typeof tag === 'string') : [];
}
