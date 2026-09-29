import styles from '#/shared/view/CapabilityNote.module.css';

// The one line a page the caller may read but not change carries, in place
// of the write actions it leaves out.
export function ViewOnlyNote({ noun, needs }: { noun: string; readonly needs: readonly string[] }) {
  return (
    <p role="note" className={styles.note}>
      {`You can view ${noun} but not change them (needs `}
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
