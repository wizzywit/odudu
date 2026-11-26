import { useLocation } from '@tanstack/react-router';
import { useState, type RefObject } from 'react';
import type { AssistantView } from '#/entities/assistant';
import { useDocked } from '#/widgets/assistant-panel/repository/useDocked';
import { useFirstRunNotice } from '#/widgets/assistant-panel/repository/useFirstRunNotice';
import { noticeScopeOf, noticeToShow } from '#/widgets/assistant-panel/services/firstRun';
import { modelsOf, type ModelEntry } from '#/widgets/assistant-panel/services/models';
import { pageContextOf, pageLabel } from '#/widgets/assistant-panel/services/pageContext';
import { modeChoices } from '#/widgets/assistant-panel/services/crossTenant';
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
  // The tenant the conversation acts in when it is not the administrator's own.
  actingIn: string | null;
  // The modes the switch draws.
  modeChoices: readonly AssistantMode[];
  // Where the administrator is, in the words the chip beside the composer shows.
  where: string;
  // The notice to show above the conversation, or null once it has been read.
  notice: FirstRunNotice | null;
  dismissNotice: () => void;
  models: ModelEntry[] | null;
  docked: boolean;
  // What is being typed, kept while the panel is put away.
  draft: string;
  setDraft: (text: string) => void;
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
  actingIn: string | null;
  view: AssistantView;
  open: boolean;
  conversationId: string | null;
  onConversation: (id: string | null) => void;
}): AssistantPanelState {
  const { tenant, view, actingIn } = options;
  const { pathname } = useLocation();
  const pageContext = pageContextOf(pathname, tenant);
  const chat = useAssistantChat(options.conversationId, FREE_CHAT, pageContext, {
    tenant,
    actingIn,
    onConversation: options.onConversation,
  });
  const read = useFirstRunNotice(noticeScopeOf(actingIn));
  const scroll = usePinnedScroll(contentSize(chat.messages), options.open);
  const docked = useDocked();
  const [draft, setDraft] = useState('');
  return {
    chat,
    mode: chat.mode,
    actingIn,
    modeChoices: modeChoices(view.modes ?? [], actingIn),
    where: pageLabel(pageContext),
    notice: noticeToShow(read.unread, view.provider, actingIn),
    dismissNotice: read.dismiss,
    models: modelsOf(view),
    docked,
    draft,
    setDraft,
    words: PANEL_WORDING,
    maxLength: COMPOSER_MAX,
    logRef: scroll.logRef,
    onScroll: scroll.onScroll,
  };
}
