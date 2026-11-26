import {
  assistantConversationSchema,
  setConversationModeResponseSchema,
  type AssistantConversation,
  type AssistantMode,
  type CreateConversationRequest,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import { adminCall } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';

const stopResponseSchema = z.object({ stopped: z.boolean() });

// Starts a conversation, on the page the person is looking at. The server
// answers one that holds no messages yet.
export function createConversation(
  gateway: Gateway,
  tenant: string,
  body: CreateConversationRequest,
): Promise<GatewayResult<AssistantConversation>> {
  return adminCall(gateway, 'POST', tenant, ['assistant', 'conversations'], {
    body,
    schema: assistantConversationSchema,
  });
}

// A conversation with its messages, bounded by what the server keeps of one.
export function loadConversation(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<AssistantConversation>> {
  return adminCall(gateway, 'GET', tenant, ['assistant', 'conversations', id], {
    schema: assistantConversationSchema,
  });
}

// Ends the turn that is running, on the server, so the spend stops. `stopped`
// is false where nothing was running.
export function stopConversation(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<{ stopped: boolean }>> {
  return adminCall(gateway, 'POST', tenant, ['assistant', 'conversations', id, 'stop'], {
    schema: stopResponseSchema,
  });
}

export function setConversationMode(
  gateway: Gateway,
  tenant: string,
  id: string,
  mode: AssistantMode,
): Promise<GatewayResult<{ mode: AssistantMode }>> {
  return adminCall(gateway, 'PUT', tenant, ['assistant', 'conversations', id, 'mode'], {
    body: { mode },
    schema: setConversationModeResponseSchema,
  });
}
