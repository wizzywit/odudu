import type { ReactNode } from 'react';
import { recordTab } from '#/shared/ui/RecordTab';

// What went wrong with an action, drawn only while there is something to say.
export function Problem({ children }: { children: string | null }) {
  if (children === null) return null;
  return (
    <p role="alert" className={recordTab.message}>
      {children}
    </p>
  );
}

// The same line kept in the page while it is empty, so a screen reader is
// already listening when the result arrives. It takes no room until then.
export function LiveMessage({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <p
      role="status"
      {...(label === undefined ? {} : { 'aria-label': label })}
      className={recordTab.message}
    >
      {children}
    </p>
  );
}
