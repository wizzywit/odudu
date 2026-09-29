import { useOverview } from '#/features/overview/usecase/useOverview.ts';
import { AttentionPanel } from '#/features/overview/view/AttentionPanel.tsx';
import { CountsPanel } from '#/features/overview/view/CountsPanel.tsx';
import { DiscoveryPanel } from '#/features/overview/view/DiscoveryPanel.tsx';
import { LatestAudit } from '#/features/overview/view/LatestAudit.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import styles from '#/features/overview/view/OverviewPage.module.css';

export function OverviewPage({ tenant }: { tenant: string }) {
  const overview = useOverview(tenant);
  return (
    <>
      <PageHeader kicker={tenant} title="Overview" />
      <div className={styles.grid}>
        <AttentionPanel attention={overview.attention} />
        <CountsPanel tiles={overview.tiles} />
        <div className={styles.wide}>
          <DiscoveryPanel discovery={overview.discovery} keys={overview.keys} />
        </div>
        <div className={styles.wide}>
          <LatestAudit audit={overview.audit} href={overview.auditHref} />
        </div>
      </div>
    </>
  );
}
