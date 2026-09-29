import type { ReactNode } from 'react';
import {
  SUBJECT_TAB_LABELS,
  SUBJECT_TABS,
  subjectName,
  subjectsTrail,
  type Subject,
  type SubjectTab,
} from '#/features/subjects/service.ts';
import { useSubjectRecordPage } from '#/features/subjects/usecase/useSubjectRecordPage.ts';
import { CredentialsTab } from '#/features/subjects/view/CredentialsTab.tsx';
import { ProfileTab } from '#/features/subjects/view/ProfileTab.tsx';
import { SubjectsGate } from '#/features/subjects/view/SubjectsGate.tsx';
import { RecordPage } from '#/shared/view/RecordPage.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';

interface PanelProps {
  readonly tenant: string;
  readonly subject: Subject;
  readonly etag: string;
  readonly gone: boolean;
  readonly canManage: boolean;
  readonly self: boolean;
}

// One panel per tab, in SUBJECT_TABS' order; a tab joins by naming its panel here.
const PANELS: Readonly<Record<SubjectTab, (props: PanelProps) => ReactNode>> = {
  profile: (props) => <ProfileTab {...props} />,
  credentials: (props) => <CredentialsTab {...props} />,
};

function Record({ tenant, id }: { tenant: string; id: string }) {
  const page = useSubjectRecordPage(tenant, id);
  const { subject, etag } = page;
  const name = subject === undefined ? 'Subject' : subjectName(subject);
  const props: PanelProps | null =
    subject === undefined || etag === null
      ? null
      : {
          tenant,
          subject,
          etag,
          gone: page.record.gone,
          canManage: page.canManage,
          self: page.self,
        };
  return (
    <RecordPage
      record={page.record}
      breadcrumb={subjectsTrail(tenant, name)}
      title={name}
      {...(subject === undefined
        ? {}
        : {
            status: subject.enabled ? (
              <StatusTag tone="active">enabled</StatusTag>
            ) : (
              <StatusTag tone="danger">disabled</StatusTag>
            ),
            description: subject.email ?? (subject.type === 'user' ? 'No email' : subject.type),
          })}
      noun="subject"
      label="Subject sections"
      tab={page.tab}
      onTabChange={page.selectTab}
      tabs={SUBJECT_TABS.map((tab) => ({
        id: tab,
        label: SUBJECT_TAB_LABELS[tab],
        dirty: page.dirty.has(tab),
        panel: props === null ? null : PANELS[tab](props),
      }))}
    />
  );
}

export function SubjectRecordPage({ tenant, id }: { tenant: string; id: string }) {
  return (
    <SubjectsGate tenant={tenant} title="Subject" breadcrumb={subjectsTrail(tenant, 'Subject')}>
      <Record tenant={tenant} id={id} />
    </SubjectsGate>
  );
}
