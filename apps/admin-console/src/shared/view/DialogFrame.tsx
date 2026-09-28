import { useId, type ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import styles from '#/shared/view/DialogFrame.module.css';

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
  readonly isOpen: boolean;
  readonly role?: 'dialog' | 'alertdialog';
  readonly title: string;
  readonly description: ReactNode;
  readonly onEscape?: () => void;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
}) {
  const describedBy = useId();
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
