import { useOverview } from '#/features/overview/use-cases/useOverview';
import { AttentionPanel } from '#/features/overview/ui/AttentionPanel';
import { CountsPanel } from '#/features/overview/ui/CountsPanel';
import { DiscoveryPanel } from '#/features/overview/ui/DiscoveryPanel';
import { LatestAudit } from '#/features/overview/ui/LatestAudit';
import { PageHeader } from '#/shared/ui/PageHeader';
import styles from '#/features/overview/ui/OverviewPage/OverviewPage.module.css';

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
