import { useOverview } from '#/features/overview/usecase/useOverview.ts';
import { AttentionPanel } from '#/features/overview/view/AttentionPanel';
import { CountsPanel } from '#/features/overview/view/CountsPanel';
import { DiscoveryPanel } from '#/features/overview/view/DiscoveryPanel';
import { LatestAudit } from '#/features/overview/view/LatestAudit';
import { PageHeader } from '#/shared/view/PageHeader';
import styles from '#/features/overview/view/OverviewPage/OverviewPage.module.css';

export function OverviewPage({ tenant }: { tenant: string }) {
  const overview = useOverview(tenant);
  return (
    <>
      <PageHeader kicker={tenant} title="Overview" />
      <div className={styles.grid}>
        <AttentionPanel attention={overview.attention} />
        {overview.tiles.length === 0 ? null : <CountsPanel tiles={overview.tiles} />}
        <div className={styles.wide}>
          <DiscoveryPanel discovery={overview.discovery} keys={overview.keys} />
        </div>
        {overview.audit === null ? null : (
          <div className={styles.wide}>
            <LatestAudit audit={overview.audit} href={overview.auditHref} />
          </div>
        )}
      </div>
    </>
  );
}
