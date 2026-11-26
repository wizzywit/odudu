import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useId, useState } from 'react';
import { useLatest } from '#/shared/lib/repository/useLatest';
import { useTransport } from '#/shared/api/transport/useTransport';
import { chatTransport } from '#/widgets/assistant-panel/adapter/chat';
import { chatMessagesOf } from '#/widgets/assistant-panel/adapter/history';
import type { ChatStatus } from '#/widgets/assistant-panel/types/chat';
import type { AssistantConversation } from '#/widgets/assistant-panel/types/contracts';

export interface ChatSession {
  messages: UIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  send: (text: string) => Promise<void>;
  // Ends the request the page has open; the server is told separately.
  abort: () => Promise<void>;
  // Carries a turn on after a change was decided.
  resume: () => Promise<void>;
  // Shows a stored conversation's messages.
  showConversation: (conversation: AssistantConversation) => void;
  clearError: () => void;
}

// The chat client over the console's gateway, for one conversation. The
// client keeps the messages and the stream's state; what starts the
// conversation, and what is done with a turn's closing parts, are handed in
// and read as they are at the time, so a render that changed them is not lost.
export function useChatSession(options: {
  tenant: string;
  startConversation: () => Promise<string>;
  onData: (part: { type: string; data?: unknown }) => void;
  // The server has accepted the turn and nothing of the answer has come yet.
  onConnected: () => void;
}): ChatSession {
  const { gateway } = useTransport();
  const id = useId();
  const start = useLatest(options.startConversation);
  const data = useLatest(options.onData);
  const connected = useLatest(options.onConnected);
  const [transport] = useState(() =>
    chatTransport({
      gateway,
      tenant: options.tenant,
      conversation: () => start()(),
      onConnected: () => {
        connected()();
      },
    }),
  );
  const chat = useChat({
    id,
    transport,
    onData: (part) => {
      data()(part);
    },
  });
  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    send: (text) => chat.sendMessage({ text }),
    abort: () => chat.stop(),
    resume: () => chat.sendMessage(),
    showConversation: (conversation) => {
      chat.setMessages(chatMessagesOf(conversation));
    },
    clearError: chat.clearError,
  };
}
