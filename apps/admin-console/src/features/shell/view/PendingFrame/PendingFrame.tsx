import type { PendingPage } from '#/features/shell/service.ts';
import { usePendingFrame } from '#/features/shell/usecase/usePendingFrame.ts';
import styles from '#/features/shell/view/PendingFrame/PendingFrame.module.css';
import { AppShell } from '#/shared/view/AppShell';
import { PageHeader } from '#/shared/view/PageHeader';
import { RailSkeleton } from '#/shared/view/Rail';
import { PageSkeleton } from '#/shared/view/Skeleton';

// The tenant's frame, with the rail and the page drawn as placeholders, for
// as long as the session is being read.
export function PendingFrame({ tenant, shape, title }: PendingPage) {
  const collapsed = usePendingFrame();
  return (
    <AppShell
      brand={`odudu · ${tenant}`}
      collapsed={collapsed}
      rail={<RailSkeleton header={<strong className={styles.brand}>odudu · {tenant}</strong>} />}
    >
      {title === null ? null : <PageHeader kicker={tenant} title={title} />}
      <PageSkeleton label="Reading your session" shape={shape} />
    </AppShell>
  );
}
