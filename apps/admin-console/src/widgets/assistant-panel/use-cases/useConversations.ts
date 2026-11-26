import { useState } from 'react';
import { useNow } from '#/shared/lib/use-cases/useNow';
import { useConversationLists } from '#/widgets/assistant-panel/repository/useConversationLists';
import { switchOutcome } from '#/widgets/assistant-panel/services/conversationFlow';
import {
  archivedLabel,
  groupConversations,
  sectionOf,
} from '#/widgets/assistant-panel/services/conversationRows';
import type { AssistantChat } from '#/widgets/assistant-panel/use-cases/useAssistantChat';
import { useConversationActions } from '#/widgets/assistant-panel/use-cases/useConversationActions';
import type {
  ConversationRow,
  ConversationsState,
  SwitchTarget,
} from '#/widgets/assistant-panel/types/conversations';

// Row times move on a minute at a time, which is as fine as "5 minutes ago" is.
const CLOCK_MS = 60_000;

// The Conversations view: whether it is showing, the person's open and
// archived conversations, and what a pick in it does. Reads are made only
// while it shows. A pick while an answer runs waits on the person to say
// whether to stop the answer, since leaving would end it unannounced.
export function useConversations(options: {
  tenant: string;
  actingIn: string | null;
  currentId: string | null;
  chat: AssistantChat;
}): ConversationsState {
  const { tenant, actingIn, currentId, chat } = options;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<SwitchTarget | null>(null);
  const lists = useConversationLists(tenant, open);
  const actions = useConversationActions(tenant, {
    id: currentId,
    markArchived: chat.markArchived,
    startNew: chat.startNew,
  });
  const now = useNow(CLOCK_MS);
  const opened = sectionOf(lists.open, actingIn);
  const archived = sectionOf(lists.archived, actingIn);

  const go = (target: SwitchTarget): void => {
    if (target.id === null) chat.startNew();
    else chat.open(target.id, target.archived);
    setPending(null);
    setOpen(false);
  };
  const request = (target: SwitchTarget): void => {
    const outcome = switchOutcome(chat.running, currentId, target.id);
    if (outcome === 'ask-to-stop') setPending(target);
    else if (outcome === 'open') go(target);
    else setOpen(false);
  };

  return {
    open,
    show: () => {
      setOpen(true);
    },
    hide: () => {
      setPending(null);
      setOpen(false);
    },
    currentId,
    groups: groupConversations(opened.rows, now),
    opened,
    archived,
    archivedLabel: archivedLabel(archived),
    now,
    pending,
    onOpen: (row: ConversationRow) => {
      request({ id: row.id, archived: row.archived });
    },
    onNew: () => {
      request({ id: null, archived: false });
    },
    onStopAndSwitch: () => {
      if (pending === null) return;
      chat.stop();
      go(pending);
    },
    onKeepWaiting: () => {
      setPending(null);
    },
    ...actions,
  };
}
