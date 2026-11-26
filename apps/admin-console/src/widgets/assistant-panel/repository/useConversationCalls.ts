import { useWrite } from '#/shared/lib/repository/useWrite';
import type { GatewayResult } from '#/shared/lib/services/result';
import { useTransport } from '#/shared/api/transport/useTransport';
import {
  createConversation,
  setConversationMode,
  stopConversation,
} from '#/widgets/assistant-panel/adapter/conversations';
import type {
  AssistantConversation,
  AssistantMode,
  CreateConversationRequest,
} from '#/widgets/assistant-panel/types/contracts';

export interface ConversationCalls {
  create: (body: CreateConversationRequest) => Promise<GatewayResult<AssistantConversation>>;
  stop: (id: string) => Promise<GatewayResult<{ stopped: boolean }>>;
  setMode: (id: string, mode: AssistantMode) => Promise<GatewayResult<{ mode: AssistantMode }>>;
  settingMode: boolean;
}

// The calls the panel makes outside the stream: starting a conversation,
// telling the server to stop a turn, and switching the mode.
export function useConversationCalls(tenant: string): ConversationCalls {
  const { gateway } = useTransport();
  const mode = useWrite<
    { id: string; mode: AssistantMode },
    GatewayResult<{ mode: AssistantMode }>
  >({
    send: (g, change) => setConversationMode(g, tenant, change.id, change.mode),
  });
  return {
    create: (body) => createConversation(gateway, tenant, body),
    stop: (id) => stopConversation(gateway, tenant, id),
    setMode: (id, next) => mode.run({ id, mode: next }),
    settingMode: mode.busy,
  };
}
