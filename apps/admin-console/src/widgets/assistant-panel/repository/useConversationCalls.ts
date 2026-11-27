import type { GatewayResult } from '#/shared/lib/services/result';
import { useTransport } from '#/shared/api/transport/useTransport';
import {
  createConversation,
  lastConversation,
  setConversationMode,
  stopConversation,
} from '#/widgets/assistant-panel/adapter/conversations';
import type {
  AssistantConversation,
  AssistantMode,
  CreateConversationRequest,
  LastAssistantConversationResponse,
} from '#/widgets/assistant-panel/types/contracts';

export interface ConversationCalls {
  create: (body: CreateConversationRequest) => Promise<GatewayResult<AssistantConversation>>;
  stop: (id: string) => Promise<GatewayResult<{ stopped: boolean }>>;
  // The conversation to reopen when the panel opens on none: the latest that
  // is not archived, or none.
  last: () => Promise<GatewayResult<LastAssistantConversationResponse>>;
  // Changes the mode of a conversation that has started.
  setMode: (id: string, mode: AssistantMode) => Promise<GatewayResult<{ mode: AssistantMode }>>;
}

// The calls the panel makes outside the stream: starting a conversation,
// telling the server to stop a turn, finding the one to reopen and switching
// a conversation's mode.
export function useConversationCalls(tenant: string): ConversationCalls {
  const { gateway } = useTransport();
  return {
    create: (body) => createConversation(gateway, tenant, body),
    stop: (id) => stopConversation(gateway, tenant, id),
    last: () => lastConversation(gateway, tenant),
    setMode: (id, mode) => setConversationMode(gateway, tenant, id, mode),
  };
}
