import type { ReactNode } from 'react';
import styles from '#/features/branding/view/Workspace/Workspace.module.css';

// The editor beside the preview of what it edits, and below it when narrow.
export function Workspace({ editor, aside }: { editor: ReactNode; aside: ReactNode }) {
  return (
    <div className={styles.frame} data-narrow-container>
      <div className={styles.workspace}>
        <div className={styles.editor}>{editor}</div>
        <aside className={styles.preview}>{aside}</aside>
      </div>
    </div>
  );
}
