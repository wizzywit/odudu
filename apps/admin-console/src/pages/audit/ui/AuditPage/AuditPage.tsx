import { AreaGate } from '#/widgets/shell';
import {
  useAuditArea,
  useAuditPage,
  type AuditPageState,
} from '#/pages/audit/use-cases/useAuditPage';
import { AuditFilters } from '#/pages/audit/ui/AuditFilters';
import { auditColumns, AuditTable } from '#/entities/audit-event';
import { Button } from '#/shared/ui/Button';
import { EmptyState } from '#/shared/ui/EmptyState';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMoreFailed } from '#/shared/ui/LoadMore';
import { LiveMessage } from '#/shared/ui/Message';
import { Note } from '#/shared/ui/Note';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Pager } from '#/shared/ui/Pager';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import styles from '#/pages/audit/ui/AuditPage/AuditPage.module.css';

function Rows({ page }: { page: AuditPageState }) {
  const { list, hrefs, narrowed, empty } = page;
  if (list.rows.length === 0 && narrowed) {
    return (
      <EmptyState
        variant="nothing-matches"
        title={empty.matchesTitle}
        action={<Button onPress={page.form.clear}>{empty.showEvery}</Button>}
      >
        {empty.matchesText}
      </EmptyState>
    );
  }
  if (list.rows.length === 0) {
    return (
      <EmptyState variant="nothing-yet" title={empty.yetTitle}>
        {empty.yetText}
      </EmptyState>
    );
  }
  return (
    <>
      <AuditTable label={page.trailLabel} rows={list.rows} withResource hrefs={hrefs} />
      <Pager label={page.trailLabel} list={list} />
      {list.loadMoreFailed ? <LoadMoreFailed noun={page.load.moreFailedNoun} /> : null}
    </>
  );
}

function Body({ page }: { page: AuditPageState }) {
  const { list } = page;
  if (list.staleCursor) {
    return (
      <EmptyState
        variant="failed"
        title={page.stale.title}
        action={<Button onPress={list.startAgain}>{page.stale.startAgain}</Button>}
      >
        {page.stale.text}
      </EmptyState>
    );
  }
  if (list.tooBroad) {
    return (
      <EmptyState
        variant="failed"
        title={page.tooBroad.title}
        action={
          <Button onPress={page.tooBroad.searchLastDay}>{page.tooBroad.searchLastDayLabel}</Button>
        }
      >
        {page.tooBroad.advice}
      </EmptyState>
    );
  }
  return (
    <ListGate
      list={list}
      loading={
        <TableSkeleton label={page.load.loading} columns={auditColumns({ withResource: true })} />
      }
      refused={{ capability: 'view-audit', noun: page.title }}
      failed={page.load.failed}
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
        title={page.title}
        kicker={tenant}
        description={page.header.description}
        {...(refused
          ? {}
          : {
              actions: (
                <Button isDisabled={page.exporting.busy} onPress={page.exporting.start}>
                  {page.exporting.busy ? page.header.exportingLabel : page.header.exportLabel}
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
            {page.notes.noCount}
            {page.range === null ? null : ` ${page.range}`}
          </p>
          <p>{page.notes.correlation}</p>
          <p>{page.notes.export}</p>
        </div>
        <LiveMessage label={page.notes.lastExport}>{page.exporting.message}</LiveMessage>
        <Body page={page} />
      </div>
    </>
  );
}

export function AuditPage({ tenant }: { tenant: string }) {
  const { area, title } = useAuditArea();
  return (
    <AreaGate tenant={tenant} area={area} title={title}>
      <Trail tenant={tenant} />
    </AreaGate>
  );
}
