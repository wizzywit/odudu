import type { ReactNode } from 'react';
import type { ResourceListState } from '#/shared/services/resourceList';
import { Button } from '#/shared/ui/Button';
import { Count } from '#/shared/ui/Count';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { EmptyState } from '#/shared/ui/EmptyState';
import { InlineFields } from '#/shared/ui/Field';
import { FilterBar } from '#/shared/ui/FilterBar';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMoreFailed } from '#/shared/ui/LoadMore';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Pager } from '#/shared/ui/Pager';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import styles from '#/shared/ui/ResourceListPage/ResourceListPage.module.css';
import type { Choice } from '#/shared/services/choice';

export function ResourceListPage<T>({
  list,
  title,
  kicker,
  description,
  actions,
  lead,
  noun,
  searchFields = [],
  filters,
  columns,
  rowKey,
  onRowAction,
  capability,
  nothingYet,
  nothingYetAction,
  notice,
  viewOnly,
  renderRows,
}: {
  list: ResourceListState<T>;
  title: string;
  kicker?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  // Drawn under the header and above the search, as a form that adds a row is.
  lead?: ReactNode;
  noun: { one: string; other: string };
  searchFields?: readonly Choice[];
  // Exact filters, drawn beside the search.
  filters?: ReactNode;
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  onRowAction?: (id: string) => void;
  // What a refused read needed, named rather than shown as a failure.
  capability: string;
  nothingYet?: ReactNode;
  nothingYetAction?: ReactNode;
  // What the last action on a row came to, drawn between the filters and the rows.
  notice?: ReactNode;
  // The one line saying what the caller may not change here.
  viewOnly?: ReactNode;
  // Draws the rows where a table would not do, as a tree; the pager stays.
  renderRows?: (rows: readonly T[]) => ReactNode;
}) {
  const count =
    list.count === null ? null : (
      <Count count={list.count.count} capped={list.count.capped} noun={noun} />
    );
  const refused = list.status === 'refused';
  return (
    <>
      <PageHeader
        title={title}
        {...(kicker === undefined ? {} : { kicker })}
        {...(description === undefined ? {} : { description })}
        {...(actions === undefined || refused ? {} : { actions })}
      />
      <div className={styles.page}>
        {refused ? null : lead}
        {refused ? null : viewOnly}
        {refused ? null : (
          <Narrowing list={list} noun={noun} searchFields={searchFields} filters={filters}>
            {count}
          </Narrowing>
        )}
        {notice}
        <ListGate
          list={list}
          loading={<TableSkeleton label={`Loading ${noun.other}`} columns={columns} />}
          refused={{ capability, noun: title }}
          failed={`${title} could not be loaded`}
          unchanged
        >
          {() => {
            if (list.rows.length === 0 && list.narrowed) {
              const query = list.search?.query;
              return (
                <EmptyState
                  variant="nothing-matches"
                  title={
                    query === undefined
                      ? `No ${noun.other} match`
                      : `No ${noun.other} match “${query}”`
                  }
                  action={<Button onPress={list.clear}>{`Show every ${noun.one}`}</Button>}
                >
                  A search matches the start of the field it names.
                </EmptyState>
              );
            }
            if (list.rows.length === 0) {
              return (
                <EmptyState
                  variant="nothing-yet"
                  title={`No ${noun.other} yet`}
                  {...(nothingYetAction === undefined ? {} : { action: nothingYetAction })}
                >
                  {nothingYet}
                </EmptyState>
              );
            }
            return (
              <>
                {renderRows === undefined ? (
                  <DataTable
                    label={title}
                    columns={columns}
                    rows={list.rows}
                    rowKey={rowKey}
                    {...(onRowAction === undefined ? {} : { onRowAction })}
                  />
                ) : (
                  renderRows(list.rows)
                )}
                <Pager label={title} list={list} />
                {list.loadMoreFailed ? <LoadMoreFailed noun={noun.other} /> : null}
              </>
            );
          }}
        </ListGate>
      </div>
    </>
  );
}

function Narrowing<T>({
  list,
  noun,
  searchFields,
  filters,
  children,
}: {
  list: ResourceListState<T>;
  noun: { one: string; other: string };
  searchFields: readonly Choice[];
  filters: ReactNode;
  children: ReactNode;
}) {
  const [first] = searchFields;
  if (first === undefined) {
    const count =
      children === undefined || children === null ? null : (
        <span className={styles.count}>{children}</span>
      );
    if (filters === undefined) return <div className={styles.toolbar}>{count}</div>;
    return (
      <div role="group" aria-label={`Filter ${noun.other}`} className={styles.toolbar}>
        <InlineFields>{filters}</InlineFields>
        {count}
        {list.narrowed ? (
          <Button variant="quiet" onPress={list.clear}>
            Clear filters
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <FilterBar
      label={`Filter ${noun.other}`}
      fields={searchFields}
      field={list.search?.field ?? first.id}
      query={list.search?.query ?? ''}
      onSearch={list.setSearch}
      onClear={list.clear}
      active={list.narrowed}
      count={children}
    >
      {filters}
    </FilterBar>
  );
}
