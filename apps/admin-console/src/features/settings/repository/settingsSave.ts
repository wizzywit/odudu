import { amendTenantSettings } from '#/entities/tenant';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import type { Gateway } from '#/shared/transport/gateway';
import { settingsRequest, type SettingValue } from '#/features/settings/services/values';

export type SectionValues = Readonly<Record<string, SettingValue>>;

// A section sends what it changed and nothing else, on the one ETag that
// stands for every setting.
export function settingsSave(tenant: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<SectionValues>) =>
    amendTenantSettings(gateway, tenant, settingsRequest(changes), ifMatch);
}
