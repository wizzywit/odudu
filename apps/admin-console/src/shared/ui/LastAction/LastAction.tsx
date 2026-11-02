import { useEffect, useRef } from 'react';
import styles from '#/shared/ui/LastAction/LastAction.module.css';
import { recordTab } from '#/shared/ui/RecordTab';

// The line saying what the last action did, kept in the page while it is
// empty. The row the action was pressed on took the focus with it, so once
// the dialog that held it is gone the line holds it, each time `count` rises.
export function LastAction({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: string | null;
}) {
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (count > 0) line.current?.focus();
  }, [count]);
  return (
    <p
      ref={line}
      tabIndex={-1}
      role="status"
      aria-label={label}
      className={`${recordTab.message ?? ''} ${styles.notice ?? ''}`}
    >
      {children}
    </p>
  );
}
