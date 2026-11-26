import { useLocation } from '@tanstack/react-router';
import type { RefObject } from 'react';
import type { AssistantView } from '#/entities/assistant';
import { useDocked } from '#/widgets/assistant-panel/repository/useDocked';
import { useFirstRunNotice } from '#/widgets/assistant-panel/repository/useFirstRunNotice';
import { noticeToShow } from '#/widgets/assistant-panel/services/firstRun';
import { modelsOf, type ModelEntry } from '#/widgets/assistant-panel/services/models';
import { pageContextOf, pageLabel } from '#/widgets/assistant-panel/services/pageContext';
import { COMPOSER_MAX } from '#/widgets/assistant-panel/services/composer';
import { contentSize } from '#/widgets/assistant-panel/services/scroll';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { AssistantMode } from '#/widgets/assistant-panel/types/chat';
import type { FirstRunNotice } from '#/widgets/assistant-panel/types/firstRun';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import {
  useAssistantChat,
  type AssistantChat,
} from '#/widgets/assistant-panel/use-cases/useAssistantChat';
import { usePinnedScroll } from '#/widgets/assistant-panel/use-cases/usePinnedScroll';

export interface AssistantPanelState {
  chat: AssistantChat;
  // The conversation's mode: Ask, or Act for one that is already in it.
  mode: AssistantMode;
  // Where the administrator is, in the words the chip beside the composer shows.
  where: string;
  // The notice to show above the conversation, or null once it has been read.
  notice: FirstRunNotice | null;
  dismissNotice: () => void;
  models: ModelEntry[] | null;
  docked: boolean;
  words: PanelWords;
  maxLength: number;
  logRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

const FREE_CHAT = 'free-chat';

// Everything the panel needs to draw: the conversation, where the person is,
// the notice they have still to read, and whether the panel has a column of
// its own or lies over the page.
export function useAssistantPanel(options: {
  tenant: string;
  view: AssistantView;
  conversationId: string | null;
  onConversation: (id: string) => void;
}): AssistantPanelState {
  const { tenant, view } = options;
  const { pathname } = useLocation();
  const pageContext = pageContextOf(pathname, tenant);
  const chat = useAssistantChat(options.conversationId, FREE_CHAT, pageContext, {
    tenant,
    onConversation: options.onConversation,
  });
  const read = useFirstRunNotice();
  const scroll = usePinnedScroll(contentSize(chat.messages));
  const docked = useDocked();
  return {
    chat,
    mode: chat.mode,
    where: pageLabel(pageContext),
    notice: noticeToShow(read.unread, view.provider),
    dismissNotice: read.dismiss,
    models: modelsOf(view),
    docked,
    words: PANEL_WORDING,
    maxLength: COMPOSER_MAX,
    logRef: scroll.logRef,
    onScroll: scroll.onScroll,
  };
}
