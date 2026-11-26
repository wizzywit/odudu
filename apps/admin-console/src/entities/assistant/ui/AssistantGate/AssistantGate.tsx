import type { ReactNode } from 'react';
import { useAssistantEntry } from '#/entities/assistant/use-cases/useAssistantEntry';
import { AssistantButton } from '#/entities/assistant/ui/AssistantButton';
import type { AssistantPanelSlot } from '#/entities/assistant/types/panelSlot';

export interface AssistantSlots {
  // The button that opens the panel, or null.
  control: ReactNode;
  // The open panel, or null.
  panel: ReactNode;
}

// Hands the shell the assistant's button and panel, and hands it nothing
// while the gate is shut: no button, no panel, no shortcut, and no request
// beyond the status read that `available` (whoami's word) lets through.
export function AssistantGate({
  tenant,
  available,
  paused,
  renderPanel,
  children,
}: {
  tenant: string;
  available: boolean;
  // A dialog is open: the shortcut would act behind it.
  paused: boolean;
  // Draws the open panel, which a layer above this one provides: what it holds
  // is the conversation, and an entity cannot import that.
  renderPanel: (slot: AssistantPanelSlot) => ReactNode;
  children: (slots: AssistantSlots) => ReactNode;
}) {
  const entry = useAssistantEntry(tenant, available, paused);
  const { words } = entry;
  return children({
    control: entry.shown ? (
      <AssistantButton
        label={words.openButton}
        hintLead={words.shortcutLead}
        shortcut={entry.shortcut}
        expanded={entry.open}
        panelId={entry.panelId}
        onPress={entry.toggle}
      />
    ) : null,
    panel: entry.open
      ? renderPanel({
          tenant,
          view: entry.view,
          id: entry.panelId,
          label: words.panelLabel,
          title: words.panelTitle,
          closeLabel: words.closeButton,
          headingRef: entry.headingRef,
          conversationId: entry.conversationId,
          onConversation: entry.rememberConversation,
          onClose: entry.close,
        })
      : null,
  });
}
