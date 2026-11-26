import { useAssistantStatusRead } from '#/entities/assistant/repository/useAssistantStatusRead';
import { assistantView, type AssistantView } from '#/entities/assistant/services/gate';
import { loadedData } from '#/shared/lib/services/read';

// `available` is the gate whoami decides (`mayUseAssistant`); nothing is
// asked while it is false. `enabled` is true only when the gate is open and
// the tenant has the assistant on; slots, modes and provider come with it.
export function useAssistantStatus(tenant: string, available: boolean): AssistantView {
  const status = useAssistantStatusRead(tenant, available);
  return assistantView(available, loadedData(status));
}
