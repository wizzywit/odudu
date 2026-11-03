import type { ReactNode } from 'react';
import { useConsoleTitle } from '#/entities/session/use-cases/useConsoleTitle';
import { BrandLine } from '#/shared/ui/BrandLine';
import styles from '#/entities/session/ui/SessionStatus/SessionStatus.module.css';

// The page shown while the session is read, or while the window leaves for a
// tenant's sign-in: a heading, and what is happening in words.
export function SessionStatus({ title, children }: { title?: string; children: ReactNode }) {
  const consoleTitle = useConsoleTitle();
  return (
    <main id="main" tabIndex={-1} className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.brand}>
          <BrandLine>{consoleTitle}</BrandLine>
        </p>
        <h1 className={styles.title}>{title ?? consoleTitle}</h1>
        {children}
      </div>
    </main>
  );
}
