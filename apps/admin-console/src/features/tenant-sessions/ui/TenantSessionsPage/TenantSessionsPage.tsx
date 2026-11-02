import type { TenantSession } from '@odudu/contracts/admin';
import { Link } from 'react-aria-components';
import { AreaGate, areaAt } from '#/features/shell';
import {
  NOTHING_YET,
  NOUN,
  PAGE_RULE,
  subjectCell,
  TITLE,
} from '#/features/tenant-sessions/services/page';
import {
  useTenantSessionsPage,
  type TenantSessionsPage as Page,
} from '#/features/tenant-sessions/use-cases/useTenantSessionsPage';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { CopyValue } from '#/shared/ui/CopyValue';
import type { Column } from '#/shared/ui/DataTable';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/features/tenant-sessions/ui/TenantSessionsPage/TenantSessionsPage.module.css';

function Subject({ session, link }: { session: TenantSession; link: Page['subjectLink'] }) {
  const { label, id } = subjectCell(session);
  const href = link?.(id);
  return (
    <span className={styles.subject}>
      {href === undefined ? (
        <span title={id}>{label}</span>
      ) : (
        <Link href={href} className={styles.name ?? ''} aria-label={`${label}, open the subject`}>
          {label}
        </Link>
      )}
      <CopyValue label="subject id" value={id} short />
    </span>
  );
}

function columns(page: Page): readonly Column<TenantSession>[] {
  return [
    {
      id: 'subject',
      header: 'Subject',
      isRowHeader: true,
      cell: (session) => <Subject session={session} link={page.subjectLink} />,
    },
    {
      id: 'clients',
      header: 'Clients',
      cell: (session) =>
        session.client_ids.length === 0 ? (
          <span className={styles.none}>none</span>
        ) : (
          session.client_ids.join(', ')
        ),
    },
    {
      id: 'created_at',
      header: 'Started',
      cell: (session) => <Timestamp value={session.created_at} />,
    },
    {
      id: 'last_active_at',
      header: 'Last active',
      cell: (session) => <Timestamp value={session.last_active_at} />,
    },
    {
      id: 'remembered',
      header: 'Remembered',
      secondary: true,
      cell: (session) => (session.remembered ? 'yes' : 'no'),
    },
  ];
}

function List({ tenant }: { tenant: string }) {
  const page = useTenantSessionsPage(tenant);
  return (
    <>
      <ResourceListPage
        list={page.list}
        kicker={tenant}
        title={TITLE}
        description={PAGE_RULE}
        actions={
          <Button
            variant="danger"
            isDisabled={page.list.rows.length === 0}
            onPress={() => {
              page.endAll.ask('all');
            }}
          >
            End every session
          </Button>
        }
        noun={NOUN}
        columns={columns(page)}
        rowKey={(session) => session.id}
        capability="manage-sessions"
        nothingYet={NOTHING_YET}
        notice={page.more === null ? undefined : <p role="status">{page.more}</p>}
      />
      <ConfirmDialog
        isOpen={page.endAll.asking !== null}
        title={`End every session in ${tenant}?`}
        consequence={page.consequence}
        confirmLabel="End every session"
        tone="danger"
        typed={tenant}
        busy={page.endAll.busy}
        problem={page.endAll.problem}
        onConfirm={page.endAll.confirm}
        onCancel={page.endAll.cancel}
      />
    </>
  );
}

export function TenantSessionsPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={areaAt('sessions')} title={TITLE}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
