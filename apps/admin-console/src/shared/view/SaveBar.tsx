import { useId } from 'react';
import { Button } from '#/shared/view/Button.tsx';
import styles from '#/shared/view/SaveBar.module.css';

export function SaveBar({
  section,
  saving,
  onDiscard,
}: {
  readonly section: string;
  readonly saving: boolean;
  readonly onDiscard: () => void;
}) {
  const shortcut = useId();
  const verb = saving ? 'Saving…' : 'Save';
  return (
    <div className={styles.bar}>
      <p className={styles.status}>
        <span className={styles.mark} aria-hidden="true" />
        Unsaved changes
      </p>
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
          isDisabled={saving}
          aria-describedby={shortcut}
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
