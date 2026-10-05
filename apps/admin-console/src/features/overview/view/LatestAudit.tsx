import type { AuditEvent } from '@odudu/contracts/admin';
import type { ReactNode } from 'react';
import { Link } from 'react-aria-components';
import type { Gated } from '#/features/overview/service.ts';
import { Panel } from '#/features/overview/view/Panel.tsx';
import { AuditActor } from '#/shared/view/AuditActor.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { TableSkeleton } from '#/shared/view/Skeleton.tsx';
import { StatusTag, type StatusTone } from '#/shared/view/StatusTag.tsx';
import { Timestamp } from '#/shared/view/Timestamp.tsx';
import styles from '#/features/overview/view/LatestAudit.module.css';

const TONES: Record<AuditEvent['outcome'], StatusTone> = {
  allowed: 'active',
  refused: 'warning',
  failed: 'danger',
};

function columns(now: Date | undefined): readonly Column<AuditEvent>[] {
  return [
    {
      id: 'when',
      header: 'When',
      isRowHeader: true,
      cell: (event) => (
        <Timestamp value={event.occurred_at} {...(now === undefined ? {} : { now })} />
      ),
    },
    { id: 'action', header: 'Action', cell: (event) => <code>{event.action}</code> },
    {
      id: 'outcome',
      header: 'Outcome',
      cell: (event) => <StatusTag tone={TONES[event.outcome]}>{event.outcome}</StatusTag>,
    },
    {
      id: 'actor',
      header: 'Actor',
      secondary: true,
      cell: (event) => <AuditActor event={event} />,
    },
  ];
}

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
      body = <TableSkeleton label="Loading the latest audit rows" columns={columns(now)} />;
      break;
    case 'failed':
      body = (
        <EmptyState
          variant="failed"
          title="The audit trail could not be read"
          action={<Button onPress={audit.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error.
        </EmptyState>
      );
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
            columns={columns(now)}
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
