import type { AssistantStatus } from '#/entities/assistant/types/assistant';
import { readAssistantStatus } from '#/entities/assistant/adapter/assistant';
import { assistantStatusKey } from '#/shared/lib/repository/queryKeys';
import { useRead } from '#/shared/lib/repository/useRead';
import { type Read } from '#/shared/lib/services/read';
import { useTransport } from '#/shared/api/transport/useTransport';

// Held back until the gate is open, so a deployment with no assistant, a
// caller who may not use it and a whoami still out are never sent the request.
export function useAssistantStatusRead(tenant: string, enabled: boolean): Read<AssistantStatus> {
  const { gateway } = useTransport();
  return useRead(assistantStatusKey(tenant), enabled, () => readAssistantStatus(gateway, tenant));
}
