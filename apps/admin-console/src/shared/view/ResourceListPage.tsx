import type { ReactNode } from 'react';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { Count } from '#/shared/view/Count.tsx';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { InlineFields, type SelectOption } from '#/shared/view/Field.tsx';
import { FilterBar } from '#/shared/view/FilterBar.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import { Pager } from '#/shared/view/Pager.tsx';
import { TableSkeleton } from '#/shared/view/Skeleton.tsx';
import styles from '#/shared/view/ResourceListPage.module.css';

export function ResourceListPage<T>({
  list,
  title,
  kicker,
  description,
  actions,
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
}: {
  list: ResourceListState<T>;
  title: string;
  kicker?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  noun: { readonly one: string; readonly other: string };
  readonly searchFields?: readonly SelectOption[];
  // Exact filters, drawn beside the search.
  filters?: ReactNode;
  readonly columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  onRowAction?: (id: string) => void;
  // What a refused read needed, named rather than shown as a failure.
  capability: string;
  nothingYet?: ReactNode;
  nothingYetAction?: ReactNode;
  // What the last action on a row came to, drawn between the filters and the rows.
  notice?: ReactNode;
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
        {refused ? null : (
          <Narrowing list={list} noun={noun} searchFields={searchFields} filters={filters}>
            {count}
          </Narrowing>
        )}
        {notice}
        <Body
          list={list}
          title={title}
          noun={noun}
          columns={columns}
          rowKey={rowKey}
          {...(onRowAction === undefined ? {} : { onRowAction })}
          capability={capability}
          {...(nothingYet === undefined ? {} : { nothingYet })}
          {...(nothingYetAction === undefined ? {} : { nothingYetAction })}
        />
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
  noun: { readonly one: string; readonly other: string };
  readonly searchFields: readonly SelectOption[];
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

function Body<T>({
  list,
  title,
  noun,
  columns,
  rowKey,
  onRowAction,
  capability,
  nothingYet,
  nothingYetAction,
}: {
  list: ResourceListState<T>;
  title: string;
  noun: { readonly one: string; readonly other: string };
  readonly columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  onRowAction?: (id: string) => void;
  capability: string;
  nothingYet?: ReactNode;
  nothingYetAction?: ReactNode;
}) {
  switch (list.status) {
    case 'loading':
      return <TableSkeleton label={`Loading ${noun.other}`} columns={columns} />;
    case 'refused':
      return <CapabilityNote capability={capability}>{title}</CapabilityNote>;
    case 'failed':
      return (
        <EmptyState
          variant="failed"
          title={`${title} could not be loaded`}
          action={<Button onPress={list.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error. Nothing was changed.
        </EmptyState>
      );
    case 'ready':
      break;
  }
  if (list.rows.length === 0 && list.narrowed) {
    const query = list.search?.query;
    return (
      <EmptyState
        variant="nothing-matches"
        title={query === undefined ? `No ${noun.other} match` : `No ${noun.other} match “${query}”`}
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
      <DataTable
        label={title}
        columns={columns}
        rows={list.rows}
        rowKey={rowKey}
        {...(onRowAction === undefined ? {} : { onRowAction })}
      />
      <Pager
        label={title}
        trail={list.trail}
        next={list.next}
        onTrailChange={list.setTrail}
        onLoadMore={list.loadMore}
        loadingMore={list.loadingMore}
      />
      {list.loadMoreFailed ? (
        <p role="alert" className={styles.failed}>
          {`More ${noun.other} could not be loaded. Load more tries again.`}
        </p>
      ) : null}
    </>
  );
}
