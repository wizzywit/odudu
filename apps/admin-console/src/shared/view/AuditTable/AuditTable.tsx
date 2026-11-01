import type { AuditEvent } from '@odudu/contracts/admin';
import { useState } from 'react';
import { Link, VisuallyHidden } from 'react-aria-components';
import {
  ELSEWHERE_NOTE,
  isElsewhere,
  requestLabel,
  requestRowCounts,
} from '#/shared/service/auditEvents';
import { counted, shortened } from '#/shared/service/format';
import { AuditActor } from '#/shared/view/AuditActor';
import { AuditDetail } from '#/shared/view/AuditDetail';
import { Button } from '#/shared/view/Button';
import { CopyValue } from '#/shared/view/CopyValue';
import { DataTable, type Column } from '#/shared/view/DataTable';
import { DialogFrame } from '#/shared/view/DialogFrame';
import { OutcomeTag, StatusTag } from '#/shared/view/StatusTag';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/shared/view/AuditTable/AuditTable.module.css';

// Where a row's resource and its actor lead, where there is a page for them.
export interface AuditHrefs {
  resource: (event: AuditEvent) => string | null;
  actor: (event: AuditEvent) => string | null;
}

interface ColumnOptions {
  now?: Date | undefined;
  withResource?: boolean;
  hrefs?: AuditHrefs | undefined;
  // How many loaded rows share each request id that more than one does.
  shared?: ReadonlyMap<string, number>;
  onOpen?: (event: AuditEvent) => void;
}

function Resource({ event, href }: { event: AuditEvent; href: string | null }) {
  if (event.resource_type === null) return <span className={styles.none}>none</span>;
  const id = event.resource_id;
  return (
    <span className={styles.resource}>
      <span>{event.resource_type}</span>
      {id === null ? null : href === null ? (
        <CopyValue label="resource id" value={id} short />
      ) : (
        <>
          <Link href={href} className={styles.link ?? ''}>
            <code>{shortened(id, 8)}</code>
            <VisuallyHidden elementType="span">{` ${event.resource_type} ${id}`}</VisuallyHidden>
          </Link>
          <CopyValue label="resource id" value={id} short />
        </>
      )}
    </span>
  );
}

function Correlation({ id, shared }: { id: string | null; shared: ReadonlyMap<string, number> }) {
  if (id === null) return <span className={styles.none}>none sent</span>;
  const rows = shared.get(id);
  return (
    <span className={styles.correlation}>
      <CopyValue label="correlation id" value={id} short />
      {rows === undefined ? null : (
        <StatusTag>{`${requestLabel(id)} · ${counted(rows, 'row', 'rows')} loaded`}</StatusTag>
      )}
    </span>
  );
}

export function auditColumns({
  now,
  withResource = false,
  hrefs,
  shared = new Map(),
  onOpen,
}: ColumnOptions): readonly Column<AuditEvent>[] {
  const resource: readonly Column<AuditEvent>[] = withResource
    ? [
        {
          id: 'resource',
          header: 'Resource',
          cell: (event) => <Resource event={event} href={hrefs?.resource(event) ?? null} />,
        },
      ]
    : [];
  return [
    {
      id: 'when',
      header: 'When',
      cell: (event) => (
        <Timestamp value={event.occurred_at} {...(now === undefined ? {} : { now })} />
      ),
      isRowHeader: true,
    },
    { id: 'action', header: 'Action', cell: (event) => <code>{event.action}</code> },
    {
      id: 'outcome',
      header: 'Outcome',
      cell: (event) => <OutcomeTag outcome={event.outcome} />,
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (event) => <AuditActor event={event} href={hrefs?.actor(event) ?? null} />,
    },
    ...resource,
    {
      id: 'correlation',
      header: 'Correlation id',
      cell: (event) => <Correlation id={event.request_id} shared={shared} />,
    },
    {
      id: 'details',
      header: 'Details',
      cell: (event) => (
        <Button
          size="small"
          variant="quiet"
          aria-label={`Details of ${event.action}`}
          onPress={() => {
            onOpen?.(event);
          }}
        >
          Details
        </Button>
      ),
    },
  ];
}

// The one account of audit rows the console draws: the Audit trail and every
// record's Activity are this table, and a row opens to all of its fields.
export function AuditTable({
  label,
  rows,
  now,
  withResource = false,
  hrefs,
}: {
  label: string;
  rows: readonly AuditEvent[];
  now?: Date;
  withResource?: boolean;
  hrefs?: AuditHrefs;
}) {
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const columns = auditColumns({
    now,
    withResource,
    hrefs,
    shared: requestRowCounts(rows),
    onOpen: setOpen,
  });
  return (
    <div className={styles.table}>
      <DataTable label={label} columns={columns} rows={rows} rowKey={(event) => event.id} />
      {rows.some((event) => isElsewhere(event.actor_origin)) ? (
        <p className={styles.note}>{ELSEWHERE_NOTE}</p>
      ) : null}
      <DialogFrame
        isOpen={open !== null}
        size="wide"
        title="Audit event"
        description={open === null ? '' : `${open.action}, ${open.outcome}`}
        onEscape={() => {
          setOpen(null);
        }}
        actions={
          <Button
            autoFocus
            onPress={() => {
              setOpen(null);
            }}
          >
            Close
          </Button>
        }
      >
        {open === null ? null : (
          <AuditDetail
            event={open}
            resourceHref={hrefs?.resource(open) ?? null}
            actorHref={hrefs?.actor(open) ?? null}
          />
        )}
      </DialogFrame>
    </div>
  );
}
