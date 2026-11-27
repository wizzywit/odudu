import type { RefObject } from 'react';
import type { AssistantView } from '#/entities/assistant/services/gate';
import type { TaskRequest } from '#/entities/assistant/types/taskRequest';

// What the shell hands the panel it draws: the tenant, what the status says
// the assistant offers, the wording the frame uses, and the conversation the
// panel was last open on, which it reports when it starts one.
export interface AssistantPanelSlot {
  tenant: string;
  // The tenant named when it is not the signed-in administrator's own: the
  // conversation is theirs, and its tools run there.
  actingIn: string | null;
  // The administrator's own username, which a card names as who decides.
  username: string;
  view: AssistantView;
  id: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  // The panel stays mounted once opened, so a closed one keeps its answer running.
  open: boolean;
  conversationId: string | null;
  // The task a page asked for, which the panel starts a new conversation for.
  task: TaskRequest | null;
  // A conversation was started (its id), or the person began a new one (null).
  onConversation: (id: string | null) => void;
  onClose: () => void;
}
