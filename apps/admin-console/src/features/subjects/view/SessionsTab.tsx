import type { Session, Subject } from '@odudu/contracts/admin';
import { useId, type ReactNode } from 'react';
import {
  useHolds,
  useSubjectSessions,
  type SubjectSessions,
} from '#/features/subjects/usecase/useSubjectSessions.ts';
import { formatAbsolute } from '#/shared/service/format.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import { Button } from '#/shared/view/Button';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { Pager } from '#/shared/view/Pager.tsx';
import { TableSkeleton } from '#/shared/view/Skeleton.tsx';
import { Timestamp } from '#/shared/view/Timestamp.tsx';
import styles from '#/features/subjects/view/Tab.module.css';

// A list a tab pages through: its loading, failure and emptiness said the
// way every list in the console says them.
export function PagedList<T>({
  list,
  label,
  noun,
  columns,
  rowKey,
  empty,
}: {
  list: ResourceListState<T>;
  label: string;
  noun: string;
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  empty: string;
}) {
  switch (list.status) {
    case 'loading':
      return <TableSkeleton label={`Loading ${noun}`} columns={columns} rows={2} />;
    case 'refused':
    case 'failed':
      return (
        <EmptyState
          variant="failed"
          title={`The ${noun} could not be loaded`}
          action={<Button onPress={list.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error.
        </EmptyState>
      );
    case 'ready':
      break;
  }
  return (
    <>
      <DataTable label={label} columns={columns} rows={list.rows} rowKey={rowKey} empty={empty} />
      <Pager
        label={label}
        trail={list.trail}
        next={list.next}
        onTrailChange={list.setTrail}
        onLoadMore={list.loadMore}
        loadingMore={list.loadingMore}
      />
    </>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function started(session: Session): string {
  return formatAbsolute(new Date(session.created_at));
}

function columns(page: SubjectSessions, withinReach: boolean): readonly Column<Session>[] {
  const shown: Column<Session>[] = [
    {
      id: 'created_at',
      header: 'Started',
      isRowHeader: true,
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
    {
      id: 'clients',
      header: 'Clients',
      cell: (session) =>
        session.client_ids.length === 0 ? (
          <span className={styles.rule}>none</span>
        ) : (
          session.client_ids.join(', ')
        ),
    },
  ];
  if (!withinReach) return shown;
  return [
    ...shown,
    {
      id: 'end',
      header: 'Action',
      cell: (session) => (
        <Button
          size="small"
          variant="quiet"
          aria-label={`End the session started ${started(session)}`}
          onPress={() => {
            page.end.ask(session);
          }}
        >
          End
        </Button>
      ),
    },
  ];
}

const OWN_ONE =
  'It may be the one this console signed you in through: if it is, the console signs you out at its next request.';
const OWN_ALL =
  'The one this console signed you in through is among them, so the console signs you out at its next request.';

function Sessions({
  tenant,
  subject,
  self,
  withinReach,
}: {
  tenant: string;
  subject: Subject;
  self: boolean;
  withinReach: boolean;
}) {
  const page = useSubjectSessions(tenant, subject);
  const { name } = page;
  return (
    <Panel title="Live sessions">
      <p className={styles.rule}>
        Each browser sign-in that has neither ended nor idled out. Ending one revokes the grants it
        holds, and tells each client that registered a back-channel logout URI.
      </p>
      <PagedList
        list={page.list}
        label={`Live sessions of ${name}`}
        noun="sessions"
        columns={columns(page, withinReach)}
        rowKey={(session) => session.id}
        empty={`${name} holds no live session.`}
      />
      {withinReach && page.list.rows.length > 0 ? (
        <div className={styles.actions}>
          <Button
            variant="danger"
            onPress={() => {
              page.endAll.ask('all');
            }}
          >
            End every session
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        isOpen={page.end.asking !== null}
        title={self ? 'End this session of your own?' : `End this session of ${name}?`}
        consequence={`Every grant it holds is revoked, and each client with a back-channel logout URI is told. A grant bound to no session, such as offline_access, stays.${self ? ` ${OWN_ONE}` : ''}`}
        confirmLabel="End session"
        tone="danger"
        busy={page.end.busy}
        problem={page.end.problem}
        onConfirm={page.end.confirm}
        onCancel={page.end.cancel}
      />
      <ConfirmDialog
        isOpen={page.endAll.asking !== null}
        title={self ? 'End every session of your own?' : `End every session of ${name}?`}
        consequence={`Every live session ${self ? 'you hold' : `${name} holds`} ends, each with its grants revoked, and each client with a back-channel logout URI is told. A grant bound to no session, an offline_access refresh token, is left: the Grants tab revokes those.${self ? ` ${OWN_ALL}` : ''}`}
        confirmLabel="End every session"
        tone="danger"
        busy={page.endAll.busy}
        problem={page.endAll.problem}
        onConfirm={page.endAll.confirm}
        onCancel={page.endAll.cancel}
      />
    </Panel>
  );
}

export function SessionsTab({
  tenant,
  subject,
  self,
  withinReach,
}: {
  tenant: string;
  subject: Subject;
  self: boolean;
  withinReach: boolean;
}) {
  const allowed = useHolds(tenant, 'manage-sessions');
  return (
    <div className={styles.tab}>
      {allowed ? (
        <Sessions tenant={tenant} subject={subject} self={self} withinReach={withinReach} />
      ) : (
        <CapabilityNote capability="manage-sessions">Sessions</CapabilityNote>
      )}
    </div>
  );
}
