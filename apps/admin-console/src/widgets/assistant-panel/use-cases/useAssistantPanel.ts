import { useLocation } from '@tanstack/react-router';
import { useEffect, useState, type RefObject } from 'react';
import { useTaskCarry, type AssistantView, type TaskRequest } from '#/entities/assistant';
import { isReadTask, taskTitleOf } from '#/features/assistant-actions';
import { useDocked } from '#/widgets/assistant-panel/repository/useDocked';
import { useFirstRunNotice } from '#/widgets/assistant-panel/repository/useFirstRunNotice';
import { noticeScopeOf, noticeToShow } from '#/widgets/assistant-panel/services/firstRun';
import { modelsOf, type ModelEntry } from '#/widgets/assistant-panel/services/models';
import { pageContextOf, pageLabel } from '#/widgets/assistant-panel/services/pageContext';
import { actingInText, actNoteOf } from '#/widgets/assistant-panel/services/crossTenant';
import { modeOfChoice } from '#/widgets/assistant-panel/services/modeSwitch';
import { COMPOSER_MAX } from '#/widgets/assistant-panel/services/composer';
import { contentSize } from '#/widgets/assistant-panel/services/scroll';
import { handoverNote, startingDraft } from '#/widgets/assistant-panel/services/taskHandover';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { AssistantMode } from '#/widgets/assistant-panel/types/chat';
import type { FirstRunNotice } from '#/widgets/assistant-panel/types/firstRun';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import type { ConversationsState } from '#/widgets/assistant-panel/types/conversations';
import {
  useAssistantChat,
  type AssistantChat,
} from '#/widgets/assistant-panel/use-cases/useAssistantChat';
import { useConversations } from '#/widgets/assistant-panel/use-cases/useConversations';
import { usePinnedScroll } from '#/widgets/assistant-panel/use-cases/usePinnedScroll';

export interface AssistantPanelState {
  chat: AssistantChat;
  // The person's conversations, and the view that lists them.
  conversations: ConversationsState;
  // The conversation's mode: Ask, or Act for one that is already in it.
  mode: AssistantMode;
  // The tenant the conversation acts in when it is not the administrator's own.
  // The words that name it, or null in the administrator's own.
  acting: string | null;
  // What the switch says of where Act makes its changes, or null.
  actNote: string | null;
  // The modes the switch draws.
  modeChoices: readonly AssistantMode[];
  // The person picked a mode on the switch; a value that is no mode is ignored.
  chooseMode: (value: string) => void;
  // Where the administrator is, in the words the chip beside the composer shows.
  where: string;
  // The task the conversation is for, in words, or null for free chat.
  task: string | null;
  // What was left by the panel this one replaced, in words, or null.
  handover: string | null;
  // Every task reads and explains: the mode switch is of no use in one.
  modeFixed: boolean;
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

// Everything the panel needs to draw: the conversation, where the person is,
// the notice they have still to read, and whether the panel has a column of
// its own or lies over the page.
export function useAssistantPanel(options: {
  tenant: string;
  actingIn: string | null;
  view: AssistantView;
  open: boolean;
  conversationId: string | null;
  // The task a page asked for: a conversation for it, its question ready in the field.
  task: TaskRequest | null;
  onConversation: (id: string | null) => void;
}): AssistantPanelState {
  const { tenant, view, actingIn } = options;
  const { pathname } = useLocation();
  const pageContext = pageContextOf(pathname, tenant);
  const chat = useAssistantChat(options.conversationId, pageContext, {
    tenant,
    actingIn,
    onConversation: options.onConversation,
    profile: options.task?.profile,
  });
  const conversations = useConversations({
    tenant,
    actingIn,
    currentId: options.conversationId,
    chat,
  });
  const read = useFirstRunNotice(noticeScopeOf(actingIn));
  const scroll = usePinnedScroll(contentSize(chat.messages, chat.approvals.entries), options.open);
  const docked = useDocked();
  const { carried, hand } = useTaskCarry(tenant);
  // What the panel this one replaced left is read once, as this one is made:
  // the panel keeps its state where the next one can read it, since it is gone
  // by the time the next one draws.
  const [left] = useState(carried);
  const [draft, setDraft] = useState(startingDraft(options.task, left));
  useEffect(() => {
    hand({ tenant, draft, stopped: chat.running });
  }, [hand, tenant, draft, chat.running]);
  // A message the server took back is written into the field again, once, so
  // nothing typed is lost whether or not the field is showing at the time.
  const [taken, setTaken] = useState<string | null>(null);
  if (chat.unsent !== taken) {
    setTaken(chat.unsent);
    if (chat.unsent !== null) setDraft(chat.unsent);
  }
  return {
    chat,
    conversations,
    mode: chat.mode,
    acting: actingInText(actingIn),
    actNote: actNoteOf(actingIn, chat.mode),
    modeChoices: view.modes ?? [],
    chooseMode: (value) => {
      const next = modeOfChoice(value);
      if (next !== null) chat.setMode(next);
    },
    where: pageLabel(pageContext),
    task: taskTitleOf(chat.profile),
    handover: handoverNote(options.task, left),
    modeFixed: isReadTask(chat.profile),
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
