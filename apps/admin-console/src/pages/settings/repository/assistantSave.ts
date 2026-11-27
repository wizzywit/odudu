import { putAssistantSettings } from '#/pages/settings/adapter/assistantSettings';
import { assistantRequest } from '#/pages/settings/services/assistantValues';
import type { SectionValues } from '#/pages/settings/repository/settingsSave';
import type { SaveInput } from '#/shared/lib/repository/useSectionSave';
import type { Gateway } from '#/shared/api/transport/gateway';

// The server replaces the whole document, so every value goes, not only the
// ones this save changed.
export function assistantSave(tenant: string) {
  return (gateway: Gateway, { values, ifMatch }: SaveInput<SectionValues>) =>
    putAssistantSettings(gateway, tenant, assistantRequest(values), ifMatch);
}
