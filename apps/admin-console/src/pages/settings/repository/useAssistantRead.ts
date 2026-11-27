import type { AssistantSettings } from '#/pages/settings/types/assistant';
import { readAssistantSettings } from '#/pages/settings/adapter/assistantSettings';
import { ASSISTANT_RECORD } from '#/pages/settings/services/assistantSection';
import { useRecord, type RecordState } from '#/shared/lib/repository/useRecord';

// Held back for a caller who may neither read nor change them, so a person
// with no business here is not sent a request that can only be refused.
export function useAssistantRead(tenant: string, enabled: boolean): RecordState<AssistantSettings> {
  return useRecord({
    tenant,
    record: ASSISTANT_RECORD,
    enabled,
    read: (gateway) => readAssistantSettings(gateway, tenant),
  });
}
