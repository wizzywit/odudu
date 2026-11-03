import type { ReactNode } from 'react';
import { Link } from 'react-aria-components';
import type { OverviewWords } from '#/features/overview/services/overviewWords';
import type { Gated } from '#/features/overview/types/overviewReads';
import { Panel } from '#/features/overview/ui/Panel';
import { auditSummaryColumns, type AuditEvent } from '#/entities/audit-event';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { DataTable } from '#/shared/ui/DataTable';
import { EmptyState } from '#/shared/ui/EmptyState';
import { LoadFailed } from '#/shared/ui/LoadFailed';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import styles from '#/features/overview/ui/LatestAudit/LatestAudit.module.css';

export function LatestAudit({
  audit,
  href,
  words,
  now,
}: {
  audit: Gated<readonly AuditEvent[]>;
  href: string;
  words: OverviewWords['audit'];
  now?: Date;
}) {
  let body: ReactNode;
  switch (audit.status) {
    case 'needs':
      body = <CapabilityNote capability={audit.capability}>{words.needs}</CapabilityNote>;
      break;
    case 'off':
    case 'loading':
      body = <TableSkeleton label={words.loading} columns={auditSummaryColumns({ now })} />;
      break;
    case 'failed':
      body = <LoadFailed title={words.failedTitle} retry={audit.retry} />;
      break;
    case 'ready':
      body =
        audit.data.length === 0 ? (
          <EmptyState variant="nothing-yet" title={words.empty}>
            {words.emptyText}
          </EmptyState>
        ) : (
          <DataTable
            label={words.table}
            columns={auditSummaryColumns({ now })}
            rows={audit.data}
            rowKey={(event) => event.id}
          />
        );
      break;
  }
  const action =
    audit.status === 'needs' ? undefined : (
      <Link href={href} className={styles.link ?? ''}>
        {words.open}
      </Link>
    );
  return (
    <Panel title={words.title} action={action}>
      {body}
    </Panel>
  );
}
