import { useId } from 'react';
import { AreaGate } from '#/widgets/shell';
import type { LaneWords } from '#/pages/signing-keys/services/laneWording';
import type { KeyRow } from '#/pages/signing-keys/services/rows';
import {
  useKeysArea,
  useSigningKeysPage,
  type LaneView,
  type SigningKeysPage as Page,
} from '#/pages/signing-keys/use-cases/useSigningKeysPage';
import { Button } from '#/shared/ui/Button';
import { AskedDialog } from '#/shared/ui/ConfirmDialog';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { EmptyState } from '#/shared/ui/EmptyState';
import { SelectField } from '#/shared/ui/Field';
import { LastAction } from '#/shared/ui/LastAction';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMore, LoadMoreFailed } from '#/shared/ui/LoadMore';
import { PageHeader } from '#/shared/ui/PageHeader';
import { LiveMessage } from '#/shared/ui/Message';
import { Panel } from '#/shared/ui/Panel';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/signing-keys/ui/SigningKeysPage/SigningKeysPage.module.css';

function columns(spec: LaneWords, page: Page): readonly Column<KeyRow>[] {
  const { columns: header, promote, retire, activeNote } = page.words;
  const common: readonly Column<KeyRow>[] = [
    {
      id: 'kid',
      header: header.key,
      isRowHeader: true,
      cell: ({ key }) => <code className={styles.kid}>{key.kid}</code>,
    },
    { id: 'alg', header: header.algorithm, cell: ({ key }) => key.alg },
    {
      id: 'created_at',
      header: header.created,
      secondary: true,
      cell: ({ key }) => <Timestamp value={key.created_at} />,
    },
  ];
  const readiness: Column<KeyRow> = {
    id: 'readiness',
    header: header.readiness,
    cell: ({ readiness: reading }) =>
      reading === null ? null : (
        <div className={styles.cell}>
          <StatusTag tone={reading.tone}>{reading.label}</StatusTag>
          <p className={styles.reading}>{reading.text}</p>
        </div>
      ),
  };
  const actions: Column<KeyRow> = {
    id: 'actions',
    header: header.actions,
    cell: ({ key, labels }) => {
      switch (spec.status) {
        case 'rotating':
          return (
            <div className={styles.actions}>
              <Button
                size="small"
                variant="quiet"
                aria-label={labels.promote}
                onPress={() => {
                  page.action.ask('promote', key);
                }}
              >
                {promote}
              </Button>
              <Button
                size="small"
                variant="quiet"
                aria-label={labels.retire}
                onPress={() => {
                  page.action.ask('retire', key);
                }}
              >
                {retire}
              </Button>
            </div>
          );
        case 'active':
          return <p className={styles.reading}>{activeNote}</p>;
        case 'retired':
          return (
            <Button
              size="small"
              variant="quiet"
              aria-label={labels.delete}
              onPress={() => {
                page.action.ask('delete', key);
              }}
            >
              {page.words.delete}
            </Button>
          );
      }
    },
  };
  return spec.status === 'rotating' ? [...common, readiness, actions] : [...common, actions];
}

function LaneBody({ spec, lane, page }: { spec: LaneWords; lane: LaneView; page: Page }) {
  const cols = columns(spec, page);
  return (
    <ListGate
      list={lane}
      loading={<TableSkeleton label={spec.loading} columns={cols} rows={2} />}
      failed={spec.failed}
      unchanged
    >
      {() =>
        lane.rows.length === 0 ? (
          <EmptyState variant="nothing-yet" title={spec.nothing}>
            {spec.empty}
          </EmptyState>
        ) : (
          <>
            <DataTable
              label={spec.label}
              columns={cols}
              rows={lane.rows}
              rowKey={({ key }) => key.id}
            />
            {lane.next === null ? null : (
              <div>
                <LoadMore
                  noun={spec.noun}
                  loading={lane.loadingMore}
                  limited={lane.loadLimited}
                  onPress={lane.loadMore}
                />
              </div>
            )}
            {lane.loadMoreFailed ? <LoadMoreFailed noun={spec.noun} /> : null}
          </>
        )
      }
    </ListGate>
  );
}

function LaneSection({ spec, page }: { spec: LaneWords; page: Page }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.lane}>
      <h2 id={heading} className={styles.heading}>
        {spec.title}
      </h2>
      <p className={styles.rule}>{spec.rule}</p>
      <LaneBody spec={spec} lane={page.lanes[spec.status]} page={page} />
    </section>
  );
}

function Stage({ page }: { page: Page }) {
  const { stage } = page.words;
  return (
    <Panel title={stage.title}>
      <p className={styles.rule}>{stage.rule}</p>
      <div className={styles.stage}>
        <SelectField
          label={stage.algorithm}
          error={page.stage.algError}
          options={stage.options}
          value={page.stage.alg}
          onChange={page.stage.choose}
        />
        <Button variant="primary" isDisabled={page.stage.busy} onPress={page.stage.start}>
          {page.stage.busy ? stage.staging : stage.submit}
        </Button>
      </div>
      <LiveMessage label={stage.last}>{page.stage.message}</LiveMessage>
    </Panel>
  );
}

function Keys({ tenant }: { tenant: string }) {
  const page = useSigningKeysPage(tenant);
  const { asking } = page.action;
  return (
    <>
      <PageHeader kicker={tenant} title={page.title} description={page.words.description} />
      <div className={styles.page}>
        <Stage page={page} />
        <LastAction label={page.words.lastAction} count={page.action.count}>
          {page.action.notice}
        </LastAction>
        {page.words.lanes.map((spec) => (
          <LaneSection key={spec.status} spec={spec} page={page} />
        ))}
      </div>
      <AskedDialog
        asked={asking?.dialog ?? null}
        busy={page.action.busy}
        problem={page.action.problem}
        onConfirm={() => {
          page.action.confirm().catch(() => undefined);
        }}
        onCancel={page.action.cancel}
      />
    </>
  );
}

export function SigningKeysPage({ tenant }: { tenant: string }) {
  const { area, title } = useKeysArea();
  return (
    <AreaGate tenant={tenant} area={area} title={title}>
      <Keys tenant={tenant} />
    </AreaGate>
  );
}
