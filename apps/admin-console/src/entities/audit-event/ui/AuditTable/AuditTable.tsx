import { Link, VisuallyHidden } from 'react-aria-components';
import { Button } from '#/shared/ui/Button';
import { CopyValue } from '#/shared/ui/CopyValue';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { DialogFrame } from '#/shared/ui/DialogFrame';
import { OutcomeTag, StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import type { AuditEvent } from '#/entities/audit-event/types/auditEvent';
import { resourceHandle } from '#/entities/audit-event/use-cases/auditCell';
import { useAuditTable } from '#/entities/audit-event/use-cases/useAuditTable';
import { AuditActor } from '#/entities/audit-event/ui/AuditActor';
import { AuditDetail } from '#/entities/audit-event/ui/AuditDetail';
import styles from '#/entities/audit-event/ui/AuditTable/AuditTable.module.css';

// Where a row's resource and its actor lead, where there is a page for them.
export interface AuditHrefs {
  resource: (event: AuditEvent) => string | null;
  actor: (event: AuditEvent) => string | null;
}

interface ColumnOptions {
  now?: Date | undefined;
  withResource?: boolean;
  hrefs?: AuditHrefs | undefined;
  // What marks each request id that more than one loaded row shares.
  tags?: ReadonlyMap<string, string>;
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
            <code>{resourceHandle(id)}</code>
            <VisuallyHidden elementType="span">{` ${event.resource_type} ${id}`}</VisuallyHidden>
          </Link>
          <CopyValue label="resource id" value={id} short />
        </>
      )}
    </span>
  );
}

function Correlation({ id, tags }: { id: string | null; tags: ReadonlyMap<string, string> }) {
  if (id === null) return <span className={styles.none}>none sent</span>;
  const tag = tags.get(id);
  return (
    <span className={styles.correlation}>
      <CopyValue label="correlation id" value={id} short />
      {tag === undefined ? null : <StatusTag>{tag}</StatusTag>}
    </span>
  );
}

function whenColumn(now: Date | undefined): Column<AuditEvent> {
  return {
    id: 'when',
    header: 'When',
    cell: (event) => (
      <Timestamp value={event.occurred_at} {...(now === undefined ? {} : { now })} />
    ),
    isRowHeader: true,
  };
}

const ACTION_COLUMN: Column<AuditEvent> = {
  id: 'action',
  header: 'Action',
  cell: (event) => <code>{event.action}</code>,
};

const OUTCOME_COLUMN: Column<AuditEvent> = {
  id: 'outcome',
  header: 'Outcome',
  cell: (event) => <OutcomeTag outcome={event.outcome} />,
};

function actorColumn(hrefs: AuditHrefs | undefined): Column<AuditEvent> {
  return {
    id: 'actor',
    header: 'Actor',
    cell: (event) => <AuditActor event={event} href={hrefs?.actor(event) ?? null} />,
  };
}

// What a row says at a glance: when, what, how it ended and who. The overview
// draws these; the trail adds the rest to them.
export function auditSummaryColumns({
  now,
}: {
  now?: Date | undefined;
}): readonly Column<AuditEvent>[] {
  return [
    whenColumn(now),
    ACTION_COLUMN,
    OUTCOME_COLUMN,
    { ...actorColumn(undefined), secondary: true },
  ];
}

export function auditColumns({
  now,
  withResource = false,
  hrefs,
  tags = new Map(),
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
    whenColumn(now),
    ACTION_COLUMN,
    OUTCOME_COLUMN,
    actorColumn(hrefs),
    ...resource,
    {
      id: 'correlation',
      header: 'Correlation id',
      cell: (event) => <Correlation id={event.request_id} tags={tags} />,
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
  const { open, openRow, closeRow, tags, elsewhereNote, dialogTitle, dialogDescription } =
    useAuditTable(rows);
  const columns = auditColumns({ now, withResource, hrefs, tags, onOpen: openRow });
  return (
    <div className={styles.table}>
      <DataTable label={label} columns={columns} rows={rows} rowKey={(event) => event.id} />
      {elsewhereNote === null ? null : <p className={styles.note}>{elsewhereNote}</p>}
      <DialogFrame
        isOpen={open !== null}
        size="wide"
        title={dialogTitle}
        description={dialogDescription}
        onEscape={closeRow}
        actions={
          <Button autoFocus onPress={closeRow}>
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
