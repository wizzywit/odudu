import type { RefObject } from 'react';
import type { AssistantView } from '#/entities/assistant/services/gate';

// What the shell hands the panel it draws: the tenant, what the status says
// the assistant offers, the wording the frame uses, and the conversation the
// panel was last open on, which it reports when it starts one.
export interface AssistantPanelSlot {
  tenant: string;
  view: AssistantView;
  id: string;
  label: string;
  title: string;
  closeLabel: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  conversationId: string | null;
  onConversation: (id: string) => void;
  onClose: () => void;
}
