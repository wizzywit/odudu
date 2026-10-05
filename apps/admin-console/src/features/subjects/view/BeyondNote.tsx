import { Button } from '#/shared/view/Button';
import styles from '#/shared/view/CapabilityNote.module.css';

const LIST = new Intl.ListFormat('en-GB', { type: 'conjunction' });

// The one line a record carries when its subject holds more than the caller,
// in place of every write the server would refuse.
export function BeyondNote({ name, beyond }: { name: string; beyond: readonly string[] }) {
  return (
    <p role="note" className={styles.note}>
      {`${name} holds ${LIST.format(beyond)}, which you do not, so you can view ${name} but change nothing here.`}
    </p>
  );
}

export function ReachFailed({ name, retry }: { name: string; retry: () => void }) {
  return (
    <p role="note" className={styles.note}>
      {`What ${name} holds could not be read, so nothing here can be changed until it is. `}
      <Button size="small" variant="quiet" onPress={retry}>
        Read it again
      </Button>
    </p>
  );
}
