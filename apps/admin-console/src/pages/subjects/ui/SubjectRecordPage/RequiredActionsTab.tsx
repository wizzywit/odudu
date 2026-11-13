import {
  useRequiredActions,
  useRequiredActionsRead,
  useRequiredActionsTab,
} from '#/pages/subjects/use-cases/useRequiredActions';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { ReadOnlyFields } from '#/shared/ui/Field';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { recordTab } from '#/shared/ui/RecordTab';
import { PagedList } from '#/pages/subjects/ui/SubjectRecordPage/SessionsTab';
import { useSubjectTermsAcceptances } from '#/pages/subjects/use-cases/useTermsAcceptances';
import type { Column } from '#/shared/ui/DataTable';
import { Panel as Card } from '#/shared/ui/Panel';
import { Timestamp } from '#/shared/ui/Timestamp';
import { type TermsAcceptance } from '#/pages/subjects/types/termsAcceptance';
import { type Subject } from '#/entities/subject';

const ACCEPTANCE_COLUMNS: readonly Column<TermsAcceptance>[] = [
  {
    id: 'version',
    header: 'Version',
    isRowHeader: true,
    cell: (row) => <code>{row.version}</code>,
  },
  { id: 'accepted', header: 'Accepted', cell: (row) => <Timestamp value={row.acceptedAt} /> },
];

function TermsAccepted({ tenant, subject }: { tenant: string; subject: Subject }) {
  const page = useSubjectTermsAcceptances(tenant, subject);
  return (
    <Card title={page.title}>
      <p className={recordTab.rule}>{page.rule}</p>
      <PagedList
        list={page.list}
        label={page.label}
        noun="accepted terms"
        columns={ACCEPTANCE_COLUMNS}
        rowKey={(row) => row.version}
        empty={page.empty}
      />
    </Card>
  );
}

function Ready({
  tenant,
  subject,
  allowed,
  ...read
}: {
  tenant: string;
  subject: Subject;
  allowed: boolean;
  data: Parameters<typeof useRequiredActions>[2];
  etag: string;
  gone: boolean;
}) {
  const {
    name,
    canManage,
    options,
    save: s,
    choose,
  } = useRequiredActions(tenant, subject, read.data, read.etag, read.gone, allowed);
  return (
    <SaveSection
      title="Required actions"
      description={`What ${name}'s next sign-in asks for, in this order, before it lets them in. Each is cleared once done.`}
      save={s}
    >
      <ReadOnlyFields when={!canManage}>
        <ChecklistField
          label={`Asked of ${name}`}
          options={options}
          value={s.values.actions}
          changed={s.changed.includes('actions')}
          onChange={choose}
        />
      </ReadOnlyFields>
    </SaveSection>
  );
}

function Panel({
  tenant,
  subject,
  canManage,
}: {
  tenant: string;
  subject: Subject;
  canManage: boolean;
}) {
  const read = useRequiredActionsRead(tenant, subject.id);
  return (
    <ReadGate
      read={read}
      label="Loading the required actions"
      fields={2}
      failed="The required actions could not be loaded"
    >
      {(data, etag) => (
        <Ready
          tenant={tenant}
          subject={subject}
          allowed={canManage}
          data={data}
          etag={etag}
          gone={read.gone}
        />
      )}
    </ReadGate>
  );
}

export function RequiredActionsTab({
  tenant,
  subject,
  canManage,
}: {
  tenant: string;
  subject: Subject;
  canManage: boolean;
}) {
  const { itself } = useRequiredActionsTab(subject);
  return (
    <div className={recordTab.tab}>
      {itself ? (
        <p className={recordTab.text}>
          {`A ${subject.type} subject signs in as itself, with its client's credentials, so it is asked for nothing at sign-in.`}
        </p>
      ) : (
        <>
          <Panel tenant={tenant} subject={subject} canManage={canManage} />
          <TermsAccepted tenant={tenant} subject={subject} />
        </>
      )}
    </div>
  );
}
