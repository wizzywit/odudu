import type { AuditEvent } from '@odudu/contracts/admin';
import type { ReactNode } from 'react';
import { Link } from 'react-aria-components';
import type { Gated } from '#/features/overview/services/reads';
import { Panel } from '#/features/overview/ui/Panel';
import { auditSummaryColumns } from '#/shared/ui/AuditTable';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { DataTable } from '#/shared/ui/DataTable';
import { EmptyState } from '#/shared/ui/EmptyState';
import { LoadFailed } from '#/shared/ui/LoadFailed';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import styles from '#/features/overview/ui/LatestAudit/LatestAudit.module.css';

export function LatestAudit({
  audit,
  href,
  now,
}: {
  audit: Gated<readonly AuditEvent[]>;
  href: string;
  now?: Date;
}) {
  let body: ReactNode;
  switch (audit.status) {
    case 'needs':
      body = <CapabilityNote capability={audit.capability}>The audit trail</CapabilityNote>;
      break;
    case 'off':
    case 'loading':
      body = (
        <TableSkeleton
          label="Loading the latest audit rows"
          columns={auditSummaryColumns({ now })}
        />
      );
      break;
    case 'failed':
      body = <LoadFailed title="The audit trail could not be read" retry={audit.retry} />;
      break;
    case 'ready':
      body =
        audit.data.length === 0 ? (
          <EmptyState variant="nothing-yet" title="Nothing recorded yet">
            Every change made in this tenant, and every change refused, is listed here.
          </EmptyState>
        ) : (
          <DataTable
            label="Latest audit rows"
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
        Open the audit trail
      </Link>
    );
  return (
    <Panel title="Latest activity" action={action}>
      {body}
    </Panel>
  );
}
