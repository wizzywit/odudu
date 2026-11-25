import { ASSISTANT_SETTING_DEFAULTS, type AssistantSettings } from '@odudu/contracts/admin';
import { settingsRepository } from '#/repository/settings';
import { type AssistantTx } from '#/repository/tx';

/** What a tenant has chosen, each setting at its default until it does. */
export async function readSettings(tx: AssistantTx, tenantId: string): Promise<AssistantSettings> {
  return (await settingsRepository(tx).get(tenantId)) ?? ASSISTANT_SETTING_DEFAULTS;
}

export async function writeSettings(
  tx: AssistantTx,
  tenantId: string,
  settings: AssistantSettings,
  now: Date,
): Promise<void> {
  await settingsRepository(tx).put(tenantId, settings, now);
}
