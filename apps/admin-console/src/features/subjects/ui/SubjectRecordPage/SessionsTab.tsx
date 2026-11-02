import type { Session, Subject } from '@odudu/contracts/admin';
import type { ReactNode } from 'react';
import {
  useHolds,
  useSubjectSessions,
  type SubjectSessions,
} from '#/features/subjects/use-cases/useSubjectSessions';
import type { AdminCapability } from '#/shared/services/principal';
import { formatAbsolute } from '#/shared/services/format';
import type { ResourceListState } from '#/shared/services/resourceList';
import { Button } from '#/shared/ui/Button';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { ListGate } from '#/shared/ui/ListGate';
import { Pager } from '#/shared/ui/Pager';
import { Panel } from '#/shared/ui/Panel';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { Timestamp } from '#/shared/ui/Timestamp';
import { recordTab } from '#/shared/ui/RecordTab';

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
  return (
    <ListGate
      list={list}
      loading={<TableSkeleton label={`Loading ${noun}`} columns={columns} rows={2} />}
      failed={`The ${noun} could not be loaded`}
    >
      {() => (
        <>
          <DataTable
            label={label}
            columns={columns}
            rows={list.rows}
            rowKey={rowKey}
            empty={empty}
          />
          <Pager label={label} list={list} />
        </>
      )}
    </ListGate>
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
          <span className={recordTab.rule}>none</span>
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
      <p className={recordTab.rule}>
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
        <div className={recordTab.actions}>
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

// A tab whose reads and writes need one admin capability, which whoami says
// the principal lacks: it is told what that needs instead.
export function HeldTab({
  tenant,
  capability,
  label,
  children,
}: {
  tenant: string;
  capability: AdminCapability;
  // What the tab is called, in "Grants needs the manage-sessions capability."
  label: string;
  children: ReactNode;
}) {
  const held = useHolds(tenant, capability);
  return (
    <div className={recordTab.tab}>
      {held ? children : <CapabilityNote capability={capability}>{label}</CapabilityNote>}
    </div>
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
  return (
    <HeldTab tenant={tenant} capability="manage-sessions" label="Sessions">
      <Sessions tenant={tenant} subject={subject} self={self} withinReach={withinReach} />
    </HeldTab>
  );
}
