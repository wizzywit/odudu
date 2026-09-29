import { useId } from 'react';
import { Button } from '#/shared/view/Button.tsx';
import { KeyHint } from '#/shared/view/KeyHint.tsx';
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
  // Enter does nothing while Save cannot run, so no key is offered then.
  const held = saving || blocked !== undefined;
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
          isDisabled={held}
          {...(blocked !== undefined
            ? { 'aria-describedby': reason }
            : saving
              ? {}
              : { 'aria-describedby': shortcut })}
          aria-label={`${verb} ${section}`}
        >
          {verb}
        </Button>
        {held ? null : <KeyHint id={shortcut} lead="or press" keys={['Enter']} />}
      </div>
    </div>
  );
}
