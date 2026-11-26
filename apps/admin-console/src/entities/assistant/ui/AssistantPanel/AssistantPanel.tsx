import { useEffect, type KeyboardEvent, type RefObject } from 'react';
import { Button } from '#/shared/ui/Button';
import { Note } from '#/shared/ui/Note';
import styles from '#/entities/assistant/ui/AssistantPanel/AssistantPanel.module.css';

// The place the conversation lives. Opening it puts the focus on its heading,
// where a screen reader starts reading; Escape and Close hand it back.
export function AssistantPanel({
  id,
  label,
  title,
  ready,
  closeLabel,
  headingRef,
  onClose,
}: {
  id: string;
  label: string;
  title: string;
  ready: string;
  closeLabel: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}) {
  useEffect(() => {
    headingRef.current?.focus();
  }, [headingRef]);
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };
  return (
    <aside id={id} aria-label={label} className={styles.panel} onKeyDown={closeOnEscape}>
      <header className={styles.header}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.title}>
          {title}
        </h2>
        <Button size="small" variant="quiet" onPress={onClose}>
          {closeLabel}
        </Button>
      </header>
      <div className={styles.body}>
        <Note>{ready}</Note>
      </div>
    </aside>
  );
}
