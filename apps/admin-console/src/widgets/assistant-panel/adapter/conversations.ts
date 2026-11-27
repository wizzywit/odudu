import {
  assistantConversationSchema,
  lastAssistantConversationResponseSchema,
  listAssistantConversationsResponseSchema,
  setConversationArchivedResponseSchema,
  setConversationModeResponseSchema,
  type AssistantConversation,
  type AssistantMode,
  type CreateConversationRequest,
  type LastAssistantConversationResponse,
  type ListAssistantConversationsResponse,
  type SetConversationArchivedResponse,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import { adminCall, nothing, segment } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult, RawBody } from '#/shared/api/transport/gateway';
import type { ExportFormat } from '#/widgets/assistant-panel/types/conversations';

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

// One page of the person's own conversations, the open ones unless `archived`
// is asked for. The cursor is the server's, bound to this list and this person.
export function listConversations(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListAssistantConversationsResponse>> {
  return adminCall(gateway, 'GET', tenant, ['assistant', 'conversations'], {
    query,
    schema: listAssistantConversationsResponseSchema,
  });
}

// The most recent conversation that is not archived, with its messages and
// whether its sign-in still lets it take a message; null when there is none.
export function lastConversation(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<LastAssistantConversationResponse>> {
  return adminCall(gateway, 'GET', tenant, ['assistant', 'last-conversation'], {
    schema: lastAssistantConversationResponseSchema,
  });
}

export function setConversationArchived(
  gateway: Gateway,
  tenant: string,
  id: string,
  archived: boolean,
): Promise<GatewayResult<SetConversationArchivedResponse>> {
  return adminCall(gateway, 'PUT', tenant, ['assistant', 'conversations', id, 'archived'], {
    body: { archived },
    schema: setConversationArchivedResponseSchema,
  });
}

// Removes the conversation and its text; the server keeps a record that one
// was deleted, and refuses one that was reported or still has a turn running.
export function deleteConversation(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['assistant', 'conversations', id], {
    schema: nothing,
  });
}

// The person's own conversation as a file, with secrets hidden by the server.
export function exportConversation(
  gateway: Gateway,
  tenant: string,
  id: string,
  format: ExportFormat,
): Promise<GatewayResult<RawBody>> {
  const t = segment(tenant);
  const c = segment(id);
  return format === 'markdown'
    ? gateway.download('GET', `admin/tenants/${t}/assistant/conversations/${c}/export/markdown`)
    : gateway.download('GET', `admin/tenants/${t}/assistant/conversations/${c}/export`);
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
