import type { Subject } from '@odudu/contracts/admin';
import { Link } from 'react-aria-components';
import { useTenantAdministrators } from '#/features/tenants/usecase/useTenantAdministrators.ts';
import { Button } from '#/shared/view/Button.tsx';
import { Count } from '#/shared/view/Count.tsx';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { Pager } from '#/shared/view/Pager.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { Timestamp } from '#/shared/view/Timestamp.tsx';
import styles from '#/features/tenants/view/AdministratorsTab.module.css';

const COLUMNS: readonly Column<Subject>[] = [
  { id: 'username', header: 'Username', isRowHeader: true, cell: (s) => s.username ?? '—' },
  { id: 'email', header: 'Email', cell: (s) => s.email ?? '—' },
  {
    id: 'enabled',
    header: 'Status',
    cell: (s) =>
      s.enabled ? (
        <StatusTag tone="active">enabled</StatusTag>
      ) : (
        <StatusTag tone="danger">disabled</StatusTag>
      ),
  },
  {
    id: 'created_at',
    header: 'Created',
    secondary: true,
    cell: (s) => <Timestamp value={s.created_at} />,
  },
];

export function AdministratorsTab({ tenant }: { tenant: string }) {
  const { list, add, addNeeds, counted, systemAdminsHref } = useTenantAdministrators(tenant);
  const label = `Administrators of ${tenant}`;
  return (
    <div className={styles.tab}>
      <p className={styles.lead}>
        {`Everybody who holds ${counted} in ${tenant}, directly, through a group or under another role. A change that would leave ${tenant} with no enabled administrator is refused: the last one cannot be disabled, deleted, or lose ${counted}.`}
        {systemAdminsHref === null ? null : (
          <>
            {' '}
            They are managed under <Link href={systemAdminsHref}>System administrators</Link>.
          </>
        )}
      </p>
      <div className={styles.actions}>
        <Button onPress={add} isDisabled={addNeeds.length > 0}>
          Add an administrator
        </Button>
        {list.count === null ? null : (
          <Count
            count={list.count.count}
            capped={list.count.capped}
            noun={{ one: 'administrator', other: 'administrators' }}
          />
        )}
      </div>
      {addNeeds.map((capability) => (
        <CapabilityNote key={capability} capability={capability}>
          Adding an administrator
        </CapabilityNote>
      ))}
      {list.status === 'loading' ? <Skeleton label="Loading administrators" lines={3} /> : null}
      {list.status === 'refused' ? (
        <CapabilityNote capability="view-users">{label}</CapabilityNote>
      ) : null}
      {list.status === 'failed' ? (
        <EmptyState
          variant="failed"
          title="The administrators could not be loaded"
          action={<Button onPress={list.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error.
        </EmptyState>
      ) : null}
      {list.status === 'ready' && list.rows.length === 0 ? (
        <EmptyState variant="nothing-yet" title="No administrators yet">
          {`Nobody can sign in to ${tenant}'s console until one is added.`}
        </EmptyState>
      ) : null}
      {list.status === 'ready' && list.rows.length > 0 ? (
        <>
          <DataTable label={label} columns={COLUMNS} rows={list.rows} rowKey={(s) => s.id} />
          <Pager
            label={label}
            trail={list.trail}
            next={list.next}
            onTrailChange={list.setTrail}
            onLoadMore={list.loadMore}
            loadingMore={list.loadingMore}
          />
        </>
      ) : null}
    </div>
  );
}
