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
