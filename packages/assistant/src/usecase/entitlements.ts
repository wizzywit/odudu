import type { AssistantTx } from '#/repository/tx';
import { limitsFromSettings, type Entitlements } from '#/service/entitlements';
import { readSettings } from '#/usecase/settings';

/** The open entitlements: a tenant's own settings, read through the transaction given. */
export function openEntitlements(tx: AssistantTx): Entitlements {
  return {
    limits: async (tenant) => limitsFromSettings(await readSettings(tx, tenant)),
  };
}
