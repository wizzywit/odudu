import { useId } from 'react';
import { Button } from '#/shared/view/Button.tsx';
import styles from '#/shared/view/SaveBar.module.css';

export function SaveBar({
  section,
  saving,
  onDiscard,
  blocked,
}: {
  section: string;
  saving: boolean;
  onDiscard: () => void;
  // Why Save is held: a choice to make before anything can be sent.
  blocked?: string | undefined;
}) {
  const shortcut = useId();
  const reason = useId();
  const verb = saving ? 'Saving…' : 'Save';
  return (
    <div className={styles.bar}>
      <p className={styles.status}>
        <span className={styles.mark} aria-hidden="true" />
        Unsaved changes
      </p>
      {blocked === undefined ? null : (
        <p id={reason} className={styles.blocked}>
          {blocked}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          variant="quiet"
          isDisabled={saving}
          onPress={onDiscard}
          aria-label={`Discard changes to ${section}`}
        >
          Discard
        </Button>
        <Button
          type="submit"
          variant="primary"
          isDisabled={saving || blocked !== undefined}
          aria-describedby={blocked === undefined ? shortcut : `${reason} ${shortcut}`}
          aria-label={`${verb} ${section}`}
        >
          {verb}
        </Button>
        <kbd id={shortcut} className={styles.shortcut}>
          Enter
        </kbd>
      </div>
    </div>
  );
}
