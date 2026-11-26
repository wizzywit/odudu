import {
  assistantSettingsSchema,
  type AssistantSettings,
  type PutAssistantSettingsRequest,
} from '@odudu/contracts/admin';
import { adminCall } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';

// A tenant whose deployment has no assistant answers 404, which the page
// reads as "nothing to show here".
export function readAssistantSettings(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<AssistantSettings>> {
  return adminCall(gateway, 'GET', tenant, ['assistant', 'settings'], {
    schema: assistantSettingsSchema,
  });
}

// A full replace: the answer is the document again, with the ETag that now
// stands for it.
export function putAssistantSettings(
  gateway: Gateway,
  tenant: string,
  settings: PutAssistantSettingsRequest,
  ifMatch: string,
): Promise<GatewayResult<AssistantSettings>> {
  return adminCall(gateway, 'PUT', tenant, ['assistant', 'settings'], {
    body: settings,
    ifMatch,
    schema: assistantSettingsSchema,
  });
}
