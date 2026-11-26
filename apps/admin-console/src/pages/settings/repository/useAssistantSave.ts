import { useRefreshAssistantStatus } from '#/entities/assistant';
import { assistantSave } from '#/pages/settings/repository/assistantSave';
import type { SectionValues } from '#/pages/settings/repository/settingsSave';
import type { SaveInput } from '#/shared/lib/repository/useSectionSave';
import type { Gateway } from '#/shared/api/transport/gateway';

// The assistant's settings save, which tells the shell to read whether the
// assistant is on again once the server has taken the change, so the button
// follows the switch without a reload.
export function useAssistantSave(tenant: string) {
  const refresh = useRefreshAssistantStatus(tenant);
  const save = assistantSave(tenant);
  return async (gateway: Gateway, input: SaveInput<SectionValues>) => {
    const result = await save(gateway, input);
    if (result.ok) refresh();
    return result;
  };
}
