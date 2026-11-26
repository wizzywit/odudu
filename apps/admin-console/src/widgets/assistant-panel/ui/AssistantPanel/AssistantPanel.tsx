import { useEffect, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import type { AssistantPanelSlot } from '#/entities/assistant';
import { useAssistantPanel } from '#/widgets/assistant-panel/use-cases/useAssistantPanel';
import { ChatLog } from '#/widgets/assistant-panel/ui/ChatLog';
import { Composer } from '#/widgets/assistant-panel/ui/Composer';
import { FirstRunNotice } from '#/widgets/assistant-panel/ui/FirstRunNotice';
import { PanelHeader } from '#/widgets/assistant-panel/ui/PanelHeader';
import { PanelNotices } from '#/widgets/assistant-panel/ui/PanelNotices';
import styles from '#/widgets/assistant-panel/ui/AssistantPanel/AssistantPanel.module.css';

function FocusHeading({
  headingRef,
  children,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  // Opening the panel puts the focus on its heading, where a screen reader
  // starts reading. The composer is one Tab away.
  useEffect(() => {
    headingRef.current?.focus();
  }, [headingRef]);
  return children;
}

// The assistant beside the page: a column of its own where the shell has the
// room, and a dialog laid over the page where it has not, with the page behind
// it out of reach and Escape to close it.
export function AssistantPanel(props: AssistantPanelSlot) {
  const { id, label, title, closeLabel, headingRef, onClose, view } = props;
  const panel = useAssistantPanel({
    tenant: props.tenant,
    view,
    conversationId: props.conversationId,
    onConversation: props.onConversation,
  });
  const { chat } = panel;
  const body = (
    <FocusHeading headingRef={headingRef}>
      <PanelHeader
        title={title}
        headingRef={headingRef}
        closeLabel={closeLabel}
        onClose={onClose}
        mode={chat.mode}
        modes={view.modes ?? []}
        switching={chat.running || chat.modeBusy}
        modeFailed={chat.modeFailed}
        onMode={chat.setMode}
        meter={chat.meter}
        models={panel.models}
        words={panel.words}
      />
      {panel.notice === null ? null : (
        <FirstRunNotice notice={panel.notice} words={panel.words} onDismiss={panel.dismissNotice} />
      )}
      <ChatLog
        messages={chat.messages}
        running={chat.running}
        loading={chat.status.kind === 'loading'}
        mode={chat.mode}
        words={panel.words}
        logRef={panel.logRef}
        onScroll={panel.onScroll}
      />
      <PanelNotices
        state={chat.status}
        statusText={chat.statusText}
        running={chat.running}
        note={chat.note}
        meter={chat.meter}
        words={panel.words}
      />
      <Composer
        running={chat.running}
        contextLabel={panel.where}
        words={panel.words}
        maxLength={panel.maxLength}
        onSend={chat.send}
        onStop={chat.stop}
      />
    </FocusHeading>
  );
  if (!panel.docked) {
    return (
      <ModalOverlay
        isOpen
        isDismissable
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        className={styles.overlay ?? ''}
      >
        <Modal className={styles.modal ?? ''}>
          <Dialog id={id} aria-label={label} className={styles.panel ?? ''}>
            {body}
          </Dialog>
        </Modal>
      </ModalOverlay>
    );
  }
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };
  return (
    <aside id={id} aria-label={label} className={styles.panel} onKeyDown={closeOnEscape}>
      {body}
    </aside>
  );
}
