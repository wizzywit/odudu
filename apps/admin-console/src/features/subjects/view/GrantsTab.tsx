import type { Grant, Subject } from '@odudu/contracts/admin';
import { useHolds, useSubjectGrants } from '#/features/subjects/usecase/useSubjectSessions.ts';
import { PagedList, Panel } from '#/features/subjects/view/SessionsTab.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';
import type { Column } from '#/shared/view/DataTable.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import { Timestamp } from '#/shared/view/Timestamp.tsx';
import styles from '#/features/subjects/view/Tab.module.css';

const COLUMNS: readonly Column<Grant>[] = [
  { id: 'client', header: 'Client', isRowHeader: true, cell: (g) => <code>{g.client_key}</code> },
  { id: 'scope', header: 'Scope', cell: (g) => g.scope },
  { id: 'created_at', header: 'Issued', cell: (g) => <Timestamp value={g.created_at} /> },
  {
    id: 'bound',
    header: 'Bound to',
    cell: (g) =>
      g.offline ? (
        <StatusTag tone="warning">offline</StatusTag>
      ) : g.session_id === null ? (
        'no session'
      ) : (
        'a session'
      ),
  },
  {
    id: 'refresh',
    header: 'Refresh until',
    secondary: true,
    cell: (g) =>
      g.refresh_expires_at === null ? (
        <span className={styles.rule}>no refresh token</span>
      ) : (
        <Timestamp value={g.refresh_expires_at} />
      ),
  },
];

// The console's own sign-in holds a grant through the built-in admin client.
const CONSOLE_CLIENT = 'odudu-admin';

function Grants({
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
  const page = useSubjectGrants(tenant, subject);
  const { name, revoke } = page;
  const asked = revoke.asking;
  return (
    <Panel title="Grants">
      <p className={styles.rule}>
        What each token is presented under, never the token. An offline grant, from offline_access,
        outlives every session, so ending sessions leaves it.
      </p>
      <PagedList
        list={page.list}
        label={`Grants ${name} holds`}
        noun="grants"
        columns={COLUMNS}
        rowKey={(grant) => grant.id}
        empty={`${name} holds no grant that is still in force.`}
      />
      {withinReach && page.clients.length > 0 ? (
        <div className={styles.actions}>
          {page.clients.map((client) => (
            <Button
              key={client.id}
              variant="danger"
              onPress={() => {
                revoke.ask(client);
              }}
            >
              {`Revoke every grant through ${client.key}`}
            </Button>
          ))}
        </div>
      ) : null}
      <ConfirmDialog
        isOpen={asked !== null}
        title={
          self
            ? `Revoke your own grants through ${asked?.key ?? ''}?`
            : `Revoke ${name}’s grants through ${asked?.key ?? ''}?`
        }
        consequence={`Every grant ${self ? 'you hold' : `${name} holds`} through ${asked?.key ?? 'it'} is revoked, offline ones included, so its refresh tokens stop working. No session ends. The consent stays, so the next sign-in through it asks nothing.${self && asked?.key === CONSOLE_CLIENT ? ' This console signs in through it, so it signs you out at its next request.' : ''}`}
        confirmLabel="Revoke grants"
        tone="danger"
        busy={revoke.busy}
        problem={revoke.problem}
        onConfirm={revoke.confirm}
        onCancel={revoke.cancel}
      />
    </Panel>
  );
}

export function GrantsTab({
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
        <Grants tenant={tenant} subject={subject} self={self} withinReach={withinReach} />
      ) : (
        <CapabilityNote capability="manage-sessions">Grants</CapabilityNote>
      )}
    </div>
  );
}
