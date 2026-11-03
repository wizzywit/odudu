import {
  useSubjectConsents,
  type SubjectConsents,
} from '#/pages/subjects/use-cases/useSubjectSessions';
import { PagedList } from '#/pages/subjects/ui/SubjectRecordPage/SessionsTab';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import type { Column } from '#/shared/ui/DataTable';
import { Panel } from '#/shared/ui/Panel';
import { Timestamp } from '#/shared/ui/Timestamp';
import { recordTab } from '#/shared/ui/RecordTab';
import { type Consent } from '#/pages/subjects/types/consent';
import { type Subject } from '#/entities/subject';

function columns(page: SubjectConsents): readonly Column<Consent>[] {
  const base: Column<Consent>[] = [
    { id: 'client', header: 'Client', isRowHeader: true, cell: (c) => <code>{c.clientKey}</code> },
    { id: 'scopes', header: 'Scopes', cell: (c) => c.scopeNames.join(' ') },
    { id: 'granted', header: 'Granted', cell: (c) => <Timestamp value={c.grantedAt} /> },
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
          aria-label={`Revoke the consent to ${consent.clientKey}`}
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
      rowKey={(consent) => consent.clientId}
      empty={`${name} has given no consent to any client.`}
    />
  );
  const asked = revoke.asking;
  return (
    <div className={recordTab.tab}>
      <Panel title="Consents">
        <p className={recordTab.rule}>
          What the consent screen recorded for each client that asks: the scopes allowed. Revoking
          one makes the next sign-in through that client ask again.
        </p>
        {body}
      </Panel>
      <ConfirmDialog
        isOpen={asked !== null}
        title={`Revoke ${name}’s consent to ${asked?.clientKey ?? ''}?`}
        consequence={`The consent goes, and every grant issued under it is revoked too, offline ones included, so ${asked?.clientKey ?? 'the client'} holds no token for ${name} that still works. The next sign-in through it asks again.`}
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
