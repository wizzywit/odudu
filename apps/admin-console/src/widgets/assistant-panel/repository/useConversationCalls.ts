import type { GatewayResult } from '#/shared/lib/services/result';
import { useTransport } from '#/shared/api/transport/useTransport';
import {
  createConversation,
  stopConversation,
} from '#/widgets/assistant-panel/adapter/conversations';
import type {
  AssistantConversation,
  CreateConversationRequest,
} from '#/widgets/assistant-panel/types/contracts';

export interface ConversationCalls {
  create: (body: CreateConversationRequest) => Promise<GatewayResult<AssistantConversation>>;
  stop: (id: string) => Promise<GatewayResult<{ stopped: boolean }>>;
}

// The calls the panel makes outside the stream: starting a conversation,
// and telling the server to stop a turn.
export function useConversationCalls(tenant: string): ConversationCalls {
  const { gateway } = useTransport();
  return {
    create: (body) => createConversation(gateway, tenant, body),
    stop: (id) => stopConversation(gateway, tenant, id),
  };
}
