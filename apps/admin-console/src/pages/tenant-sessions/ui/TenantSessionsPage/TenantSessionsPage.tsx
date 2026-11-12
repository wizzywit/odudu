import { Link } from 'react-aria-components';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import type { TenantSession } from '#/pages/tenant-sessions/types/tenantSession';
import {
  useTenantSessionsPage,
  type TenantSessionsPage as Page,
} from '#/pages/tenant-sessions/use-cases/useTenantSessionsPage';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { CopyValue } from '#/shared/ui/CopyValue';
import type { Column } from '#/shared/ui/DataTable';
import { DeviceCell } from '#/shared/ui/DeviceCell';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/tenant-sessions/ui/TenantSessionsPage/TenantSessionsPage.module.css';

const AREA = areaAt('sessions');

function Subject({ session, page }: { session: TenantSession; page: Page }) {
  const { label, id } = page.subjectOf(session);
  const href = page.subjectLink?.(id);
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
      cell: (session) => <Subject session={session} page={page} />,
    },
    {
      id: 'clients',
      header: 'Clients',
      cell: (session) =>
        session.clientIds.length === 0 ? (
          <span className={styles.none}>none</span>
        ) : (
          session.clientIds.join(', ')
        ),
    },
    {
      id: 'device',
      header: 'Device',
      secondary: true,
      cell: (session) => (
        <DeviceCell device={session.device} caption={page.deviceCaption(session.device)} />
      ),
    },
    {
      id: 'created_at',
      header: 'Started',
      cell: (session) => <Timestamp value={session.createdAt} />,
    },
    {
      id: 'last_active_at',
      header: 'Last active',
      cell: (session) => <Timestamp value={session.lastActiveAt} />,
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
        title={AREA.label}
        description={page.text.rule}
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
        noun={page.text.noun}
        columns={columns(page)}
        rowKey={(session) => session.id}
        capability="manage-sessions"
        nothingYet={page.text.nothingYet}
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
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
