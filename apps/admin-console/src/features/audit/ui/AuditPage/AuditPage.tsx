import { AreaGate, areaAt } from '#/features/shell';
import { TOO_BROAD_TITLE } from '#/features/audit/services/broad';
import { EXPORT_NOTE } from '#/features/audit/services/export';
import {
  NO_COUNT,
  NOTHING_MATCHES,
  NOTHING_YET,
  STALE_TEXT,
  STALE_TITLE,
} from '#/features/audit/services/page';
import { useAuditPage, type AuditPageState } from '#/features/audit/use-cases/useAuditPage';
import { AuditFilters } from '#/features/audit/ui/AuditFilters';
import { CORRELATION_NOTE } from '#/shared/services/auditEvents';
import { auditColumns, AuditTable } from '#/shared/ui/AuditTable';
import { Button } from '#/shared/ui/Button';
import { EmptyState } from '#/shared/ui/EmptyState';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMoreFailed } from '#/shared/ui/LoadMore';
import { LiveMessage } from '#/shared/ui/Message';
import { Note } from '#/shared/ui/Note';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Pager } from '#/shared/ui/Pager';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import styles from '#/features/audit/ui/AuditPage/AuditPage.module.css';

const AREA = areaAt('audit');

function Rows({ page }: { page: AuditPageState }) {
  const { list, hrefs, narrowed } = page;
  if (list.rows.length === 0 && narrowed) {
    return (
      <EmptyState
        variant="nothing-matches"
        title="No event matches these filters"
        action={<Button onPress={page.form.clear}>Show every event</Button>}
      >
        {NOTHING_MATCHES}
      </EmptyState>
    );
  }
  if (list.rows.length === 0) {
    return (
      <EmptyState variant="nothing-yet" title="No audit events yet">
        {NOTHING_YET}
      </EmptyState>
    );
  }
  return (
    <>
      <AuditTable label="Audit events" rows={list.rows} withResource hrefs={hrefs} />
      <Pager label="Audit events" list={list} />
      {list.loadMoreFailed ? <LoadMoreFailed noun="audit events" /> : null}
    </>
  );
}

function Body({ page }: { page: AuditPageState }) {
  const { list } = page;
  if (list.staleCursor) {
    return (
      <EmptyState
        variant="failed"
        title={STALE_TITLE}
        action={<Button onPress={list.startAgain}>Start again</Button>}
      >
        {STALE_TEXT}
      </EmptyState>
    );
  }
  if (list.tooBroad) {
    return (
      <EmptyState
        variant="failed"
        title={TOO_BROAD_TITLE}
        action={<Button onPress={page.tooBroad.searchLastDay}>Search the last 24 hours</Button>}
      >
        {page.tooBroad.advice}
      </EmptyState>
    );
  }
  return (
    <ListGate
      list={list}
      loading={
        <TableSkeleton
          label="Loading audit events"
          columns={auditColumns({ withResource: true })}
        />
      }
      refused={{ capability: 'view-audit', noun: AREA.label }}
      failed="The audit trail could not be loaded"
      unchanged
    >
      {() => <Rows page={page} />}
    </ListGate>
  );
}

function Trail({ tenant }: { tenant: string }) {
  const page = useAuditPage(tenant);
  const refused = page.list.status === 'refused';
  return (
    <>
      <PageHeader
        title={AREA.label}
        kicker={tenant}
        description="Every change made in this tenant, and every one refused, with who made it and from where."
        {...(refused
          ? {}
          : {
              actions: (
                <Button isDisabled={page.exporting.busy} onPress={page.exporting.start}>
                  {page.exporting.busy ? 'Exporting…' : 'Export these events'}
                </Button>
              ),
            })}
      />
      <div className={styles.page}>
        {refused ? null : <AuditFilters form={page.form} />}
        {page.list.ignored.map((text) => (
          <Note key={text}>{text}</Note>
        ))}
        <div className={styles.meta}>
          <p>
            {NO_COUNT}
            {page.range === null ? null : ` ${page.range}`}
          </p>
          <p>{CORRELATION_NOTE}</p>
          <p>{EXPORT_NOTE}</p>
        </div>
        <LiveMessage label="Last export">{page.exporting.message}</LiveMessage>
        <Body page={page} />
      </div>
    </>
  );
}

export function AuditPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <Trail tenant={tenant} />
    </AreaGate>
  );
}
