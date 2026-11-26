import type { ReactNode } from 'react';
import { useAssistantEntry } from '#/entities/assistant/use-cases/useAssistantEntry';
import { AssistantButton } from '#/entities/assistant/ui/AssistantButton';
import { AssistantPanel } from '#/entities/assistant/ui/AssistantPanel';

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
  children,
}: {
  tenant: string;
  available: boolean;
  children: (slots: AssistantSlots) => ReactNode;
}) {
  const entry = useAssistantEntry(tenant, available);
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
    panel: entry.open ? (
      <AssistantPanel
        id={entry.panelId}
        label={words.panelLabel}
        title={words.panelTitle}
        ready={words.panelReady}
        closeLabel={words.closeButton}
        headingRef={entry.headingRef}
        onClose={entry.close}
      />
    ) : null,
  });
}
