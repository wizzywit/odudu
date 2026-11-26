import { assistantStatusSchema } from '@odudu/contracts/admin';
import type { AssistantStatus } from '#/entities/assistant/types/assistant';
import { adminCall } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';

// What the assistant is for this tenant: its slots, modes and provider, or
// that the tenant has switched it off. A caller without `use-assistant` is
// refused, so the read is never made for one.
export function readAssistantStatus(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<AssistantStatus>> {
  return adminCall(gateway, 'GET', tenant, ['assistant', 'status'], {
    schema: assistantStatusSchema,
  });
}
