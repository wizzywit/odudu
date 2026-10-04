import styles from '#/shared/view/CapabilityNote.module.css';

// The one line a page the caller may read but not change carries, in place
// of the write actions it leaves out.
export function ViewOnlyNote({
  noun,
  change = 'change them',
  needs,
}: {
  noun: string;
  // What the caller may not do here, when it is less than all of it.
  change?: string;
  needs: readonly string[];
}) {
  return (
    <p role="note" className={styles.note}>
      {`You can view ${noun} but not ${change} (needs `}
      {needs.map((capability, i) => (
        <span key={capability}>
          {i === 0 ? null : i === needs.length - 1 ? ' and ' : ', '}
          <code className={styles.capability}>{capability}</code>
        </span>
      ))}
      ).
    </p>
  );
}
