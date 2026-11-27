import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import type { AssistantPanelSlot } from '#/entities/assistant';
import { useAssistantPanel } from '#/widgets/assistant-panel/use-cases/useAssistantPanel';
import { ChatLog } from '#/widgets/assistant-panel/ui/ChatLog';
import { Composer } from '#/widgets/assistant-panel/ui/Composer';
import { ConversationsView } from '#/widgets/assistant-panel/ui/ConversationsView';
import { ReadOnlyBar } from '#/widgets/assistant-panel/ui/ReadOnlyBar';
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

// Puts the focus back on the button that opened the list once it is put away.
// Not on the first draw, which belongs to the heading.
function useListReturn(open: boolean, buttonRef: RefObject<HTMLButtonElement | null>): void {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    buttonRef.current?.focus();
  }, [open, buttonRef]);
}

// The assistant beside the page (and kept mounted while it is closed): a column of its own where the shell has the
// room, and a dialog laid over the page where it has not, with the page behind
// it out of reach and Escape to close it.
export function AssistantPanel(props: AssistantPanelSlot) {
  const { id, label, title, closeLabel, headingRef, onClose, view, open } = props;
  const panel = useAssistantPanel({
    tenant: props.tenant,
    actingIn: props.actingIn,
    view,
    open,
    conversationId: props.conversationId,
    onConversation: props.onConversation,
  });
  const { chat, conversations } = panel;
  const conversationsRef = useRef<HTMLButtonElement>(null);
  useListReturn(conversations.open, conversationsRef);
  // While the list shows, Escape goes back to the conversation; closing the
  // panel is for the next one.
  const backOnEscape = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || !conversations.open) return;
    event.preventDefault();
    conversations.hide();
  };
  // Moving to a card is the person's own act: the card never takes the focus itself.
  const jump = (): void => {
    const card = panel.logRef.current?.querySelector<HTMLElement>('[data-approval-card]');
    card?.focus();
  };
  const body = (
    <FocusHeading headingRef={headingRef}>
      <div className={styles.stage} onKeyDown={backOnEscape}>
        <div
          className={styles.chat}
          data-away={conversations.open || undefined}
          aria-hidden={conversations.open || undefined}
          inert={conversations.open}
        >
          <PanelHeader
            title={title}
            headingRef={headingRef}
            closeLabel={closeLabel}
            onClose={onClose}
            canStartNew={chat.canStartNew}
            onStartNew={chat.startNew}
            onShowConversations={conversations.show}
            conversationsRef={conversationsRef}
            mode={panel.mode}
            modes={panel.modeChoices}
            onModeChange={panel.chooseMode}
            modeDisabled={chat.running || chat.readOnly !== null}
            modeProblem={chat.modeProblem}
            acting={panel.acting}
            meter={chat.meter}
            models={panel.models}
            words={panel.words}
          />
          {panel.notice === null ? null : (
            <FirstRunNotice
              notice={panel.notice}
              words={panel.words}
              onDismiss={panel.dismissNotice}
            />
          )}
          <ChatLog
            messages={chat.messages}
            running={chat.running}
            loading={chat.status.kind === 'loading'}
            mode={panel.mode}
            entries={chat.approvals.entries}
            username={props.username}
            words={panel.words}
            logRef={panel.logRef}
            onScroll={panel.onScroll}
            onDecide={chat.approvals.answer}
          />
          <PanelNotices
            state={chat.status}
            statusText={chat.statusText}
            running={chat.running}
            note={chat.note}
            meter={chat.meter}
            unavailable={chat.unavailable}
            onJump={chat.approvals.waiting ? jump : null}
            words={panel.words}
          />
          {chat.readOnly === null ? (
            <Composer
              running={chat.running}
              blocked={chat.blocked}
              contextLabel={panel.where}
              draft={panel.draft}
              onDraft={panel.setDraft}
              words={panel.words}
              maxLength={panel.maxLength}
              onSend={chat.send}
              onStop={chat.stop}
            />
          ) : (
            <ReadOnlyBar
              reason={chat.readOnly}
              words={panel.words}
              onRestore={conversations.onRestoreCurrent}
              onStartNew={chat.startNew}
            />
          )}
        </div>
        <ConversationsView state={conversations} words={panel.words} />
      </div>
    </FocusHeading>
  );
  // Closed, the panel draws nothing but stays mounted, so an answer in progress
  // goes on and is there again when it is opened.
  if (!open) return null;
  if (!panel.docked) {
    return (
      <ModalOverlay
        isOpen
        isDismissable
        isKeyboardDismissDisabled={conversations.open}
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
