import { Link } from 'react-aria-components';
import { holderFilterOptions } from '#/features/subjects/services';
import {
  useCapabilityHolders,
  type Holder,
} from '#/features/subjects/use-cases/useCapabilityHolders';
import { SubjectCapabilities } from '#/features/subjects/ui/SubjectRecordPage';
import { Button } from '#/shared/ui/Button';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { Count } from '#/shared/ui/Count';
import { EmptyState } from '#/shared/ui/EmptyState';
import { SelectField } from '#/shared/ui/Field';
import { FilterBar } from '#/shared/ui/FilterBar';
import { ListGate } from '#/shared/ui/ListGate';
import { Pager } from '#/shared/ui/Pager';
import { ListSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/features/subjects/ui/CapabilityHolders/CapabilityHolders.module.css';
import { STATUS_FILTER } from '#/shared/services/filters';

const NOUN = { one: 'administrator', other: 'administrators' };
const SEARCH = [{ id: 'username', label: 'Username' }];
function Row({
  tenant,
  authorityTenant,
  holder,
  open,
  canChange,
  onToggle,
}: {
  tenant: string;
  authorityTenant: string;
  holder: Holder;
  open: boolean;
  canChange: boolean;
  onToggle: () => void;
}) {
  const editor = `capabilities-${holder.subject.id}`;
  return (
    <li className={styles.holder}>
      <div className={styles.head}>
        <Link href={holder.href} className={styles.name ?? ''}>
          {holder.name}
        </Link>
        {holder.subject.enabled ? null : <StatusTag tone="danger">disabled</StatusTag>}
        {holder.reachesEveryTenant ? (
          <StatusTag tone="system-authority">reaches every tenant</StatusTag>
        ) : null}
        <span className={styles.how}>
          Created <Timestamp value={holder.subject.created_at} />
        </span>
      </div>
      <ul aria-label={`What ${holder.name} holds`} className={styles.held}>
        {holder.lines.map((line) => (
          <li key={line.holding}>
            <code>{line.label}</code>
            <span className={styles.how}>{` · ${line.how}`}</span>
          </li>
        ))}
      </ul>
      {canChange ? (
        <div className={styles.actions}>
          <Button size="small" aria-expanded={open} aria-controls={editor} onPress={onToggle}>
            {open ? `Close ${holder.name}’s capabilities` : `Change ${holder.name}’s capabilities`}
          </Button>
        </div>
      ) : null}
      <div id={editor} className={styles.editor}>
        {open ? (
          <SubjectCapabilities
            tenant={tenant}
            subject={holder.subject}
            authorityTenant={authorityTenant}
            self={holder.self}
          />
        ) : null}
      </div>
    </li>
  );
}

// Everybody holding an admin capability in a tenant, a page at a time, with
// what each holds, each one's own set open for change in place.
export function CapabilityHolders({
  tenant,
  authorityTenant = tenant,
  canChange,
}: {
  tenant: string;
  authorityTenant?: string;
  // False once whoami says a change would be refused.
  canChange: boolean;
}) {
  const page = useCapabilityHolders(tenant);
  const { list } = page;
  const label = `Administrators of ${tenant}`;
  if (list.status === 'refused') {
    return <CapabilityNote capability="view-users">{label}</CapabilityNote>;
  }
  const body = (
    <ListGate
      list={list}
      loading={<ListSkeleton label="Loading administrators" />}
      failed="The administrators could not be loaded"
    >
      {() =>
        page.holders.length === 0 ? (
          list.narrowed ? (
            <EmptyState
              variant="nothing-matches"
              title="No administrators match"
              action={<Button onPress={list.clear}>Show every administrator</Button>}
            >
              A search matches the start of the username.
            </EmptyState>
          ) : (
            <EmptyState variant="nothing-yet" title="No administrators yet">
              {`Nobody holds an admin capability in ${tenant}, so nobody can sign in to its console until one is added.`}
            </EmptyState>
          )
        ) : (
          <>
            <ul aria-label={label} className={styles.list}>
              {page.holders.map((holder) => (
                <Row
                  key={holder.subject.id}
                  tenant={tenant}
                  authorityTenant={authorityTenant}
                  holder={holder}
                  open={page.open === holder.subject.id}
                  canChange={canChange}
                  onToggle={() => {
                    page.toggle(holder.subject.id);
                  }}
                />
              ))}
            </ul>
            <Pager label="Administrators" list={list} />
          </>
        )
      }
    </ListGate>
  );
  return (
    <div className={styles.holders}>
      <FilterBar
        label="Filter administrators"
        fields={SEARCH}
        field="username"
        query={list.search?.query ?? ''}
        onSearch={list.setSearch}
        onClear={list.clear}
        active={list.narrowed}
      >
        <SelectField
          label="Status"
          options={STATUS_FILTER}
          value={list.filters.enabled ?? 'any'}
          onChange={(value) => {
            list.setFilter('enabled', value === 'any' ? null : value);
          }}
        />
        <SelectField
          label="Holds"
          options={holderFilterOptions(tenant)}
          value={list.filters.capability ?? 'any'}
          onChange={(value) => {
            list.setFilter('capability', value === 'any' ? null : value);
          }}
        />
      </FilterBar>
      {list.count === null ? null : (
        <p className={styles.count}>
          <Count count={list.count.count} capped={list.count.capped} noun={NOUN} />
        </p>
      )}
      {body}
    </div>
  );
}
