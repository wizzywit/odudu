import { type PendingPage } from '#/widgets/shell/services/pending';
import { usePendingFrame } from '#/widgets/shell/use-cases/usePendingFrame';
import { useShellText } from '#/widgets/shell/use-cases/useShellText';
import styles from '#/widgets/shell/ui/PendingFrame/PendingFrame.module.css';
import { AppShell } from '#/shared/ui/AppShell';
import { BrandLine } from '#/shared/ui/BrandLine';
import { PageHeader } from '#/shared/ui/PageHeader';
import { RailSkeleton } from '#/shared/ui/Rail';
import { PageSkeleton } from '#/shared/ui/Skeleton';

// The tenant's frame, with the rail and the page drawn as placeholders, for
// as long as the session is being read.
export function PendingFrame({ tenant, shape, title }: PendingPage) {
  const collapsed = usePendingFrame();
  const { brandText } = useShellText();
  return (
    <AppShell
      brand={brandText(tenant)}
      collapsed={collapsed}
      rail={
        <RailSkeleton
          header={
            <strong className={styles.brand}>
              <BrandLine>{brandText(tenant)}</BrandLine>
            </strong>
          }
        />
      }
    >
      {title === null ? null : <PageHeader kicker={tenant} title={title} />}
      <PageSkeleton label="Reading your session" shape={shape} />
    </AppShell>
  );
}
