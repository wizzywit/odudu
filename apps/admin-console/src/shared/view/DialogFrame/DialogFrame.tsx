import { useContext, useEffect, useId, type ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { DialogPresence } from '#/shared/view/dialogPresence.ts';
import styles from '#/shared/view/DialogFrame/DialogFrame.module.css';

// The one dialog layer: a dialog only stops you, so it never closes on an
// outside press, and Escape counts as the safe answer where there is one.
export function DialogFrame({
  isOpen,
  role = 'dialog',
  title,
  description,
  onEscape,
  children,
  actions,
}: {
  isOpen: boolean;
  role?: 'dialog' | 'alertdialog';
  title: string;
  description: ReactNode;
  onEscape?: () => void;
  children?: ReactNode;
  actions: ReactNode;
}) {
  const describedBy = useId();
  const reportOpen = useContext(DialogPresence);
  useEffect(() => (isOpen ? reportOpen() : undefined), [isOpen, reportOpen]);
  return (
    <ModalOverlay
      isOpen={isOpen}
      isKeyboardDismissDisabled={onEscape === undefined}
      onOpenChange={(open) => {
        if (!open) onEscape?.();
      }}
      className={styles.overlay ?? ''}
    >
      <Modal className={styles.modal ?? ''}>
        <Dialog role={role} aria-describedby={describedBy} className={styles.dialog ?? ''}>
          <Heading slot="title" className={styles.title ?? ''}>
            {title}
          </Heading>
          <div id={describedBy} className={styles.description}>
            {description}
          </div>
          {children === undefined ? null : <div className={styles.body}>{children}</div>}
          <div className={styles.actions}>{actions}</div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
