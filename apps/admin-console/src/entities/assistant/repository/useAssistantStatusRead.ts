import type { AssistantStatus } from '#/entities/assistant/types/assistant';
import { readAssistantStatus } from '#/entities/assistant/adapter/assistant';
import { ASSISTANT_STATUS_RECORD } from '#/entities/assistant/services/records';
import { useRecord, type RecordState } from '#/shared/lib/repository/useRecord';

// Held back until the gate is open, so a deployment with no assistant, a
// caller who may not use it and a whoami still out are never sent the request.
export function useAssistantStatusRead(
  tenant: string,
  enabled: boolean,
): RecordState<AssistantStatus> {
  return useRecord({
    tenant,
    record: ASSISTANT_STATUS_RECORD,
    enabled,
    read: (gateway) => readAssistantStatus(gateway, tenant),
  });
}
