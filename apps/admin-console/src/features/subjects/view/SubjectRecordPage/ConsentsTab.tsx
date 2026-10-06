import type { Consent, Subject } from '@odudu/contracts/admin';
import {
  useSubjectConsents,
  type SubjectConsents,
} from '#/features/subjects/usecase/useSubjectSessions.ts';
import { PagedList, Panel } from '#/features/subjects/view/SubjectRecordPage/SessionsTab.tsx';
import { Button } from '#/shared/view/Button';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import type { Column } from '#/shared/view/DataTable';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/subjects/view/SubjectRecordPage/Tab.module.css';

function columns(page: SubjectConsents): readonly Column<Consent>[] {
  const base: Column<Consent>[] = [
    { id: 'client', header: 'Client', isRowHeader: true, cell: (c) => <code>{c.client_key}</code> },
    { id: 'scopes', header: 'Scopes', cell: (c) => c.scope_names.join(' ') },
    { id: 'granted', header: 'Granted', cell: (c) => <Timestamp value={c.granted_at} /> },
  ];
  if (!page.canManage) return base;
  return [
    ...base,
    {
      id: 'revoke',
      header: 'Action',
      cell: (consent) => (
        <Button
          size="small"
          variant="quiet"
          aria-label={`Revoke the consent to ${consent.client_key}`}
          onPress={() => {
            page.revoke.ask(consent);
          }}
        >
          Revoke
        </Button>
      ),
    },
  ];
}

export function ConsentsTab({
  tenant,
  subject,
  canManage,
}: {
  tenant: string;
  subject: Subject;
  canManage: boolean;
}) {
  const page = useSubjectConsents(tenant, subject, canManage);
  const { name, consents, revoke } = page;
  const shape = columns(page);
  const body = (
    <PagedList
      list={consents}
      label={`Consents ${name} has given`}
      noun="consents"
      columns={shape}
      rowKey={(consent) => consent.client_id}
      empty={`${name} has given no consent to any client.`}
    />
  );
  const asked = revoke.asking;
  return (
    <div className={styles.tab}>
      <Panel title="Consents">
        <p className={styles.rule}>
          What the consent screen recorded for each client that asks: the scopes allowed. Revoking
          one makes the next sign-in through that client ask again.
        </p>
        {body}
      </Panel>
      <ConfirmDialog
        isOpen={asked !== null}
        title={`Revoke ${name}’s consent to ${asked?.client_key ?? ''}?`}
        consequence={`The consent goes, and every grant issued under it is revoked too, offline ones included, so ${asked?.client_key ?? 'the client'} holds no token for ${name} that still works. The next sign-in through it asks again.`}
        confirmLabel="Revoke consent"
        tone="danger"
        busy={revoke.busy}
        problem={revoke.problem}
        onConfirm={revoke.confirm}
        onCancel={revoke.cancel}
      />
    </div>
  );
}
