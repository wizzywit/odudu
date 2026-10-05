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
import { ActivityPanel } from '#/features/subjects/view/ActivityPanel.tsx';
import { ConsentsTab } from '#/features/subjects/view/ConsentsTab.tsx';
import { GrantsTab } from '#/features/subjects/view/GrantsTab.tsx';
import { SessionsTab } from '#/features/subjects/view/SessionsTab.tsx';
import { CredentialsTab } from '#/features/subjects/view/CredentialsTab.tsx';
import { GroupsTab } from '#/features/subjects/view/GroupsTab.tsx';
import { RequiredActionsTab } from '#/features/subjects/view/RequiredActionsTab.tsx';
import { RolesTab } from '#/features/subjects/view/RolesTab.tsx';
import { ProfileTab } from '#/features/subjects/view/ProfileTab.tsx';
import { SubjectsGate } from '#/features/subjects/view/SubjectsGate.tsx';
import { RecordPage } from '#/shared/view/RecordPage';
import { StatusTag } from '#/shared/view/StatusTag';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote';
import { BeyondNote, ReachFailed } from '#/features/subjects/view/BeyondNote.tsx';

interface PanelProps {
  tenant: string;
  subject: Subject;
  etag: string;
  gone: boolean;
  // manage-users is held, and the subject is within the caller's reach.
  canManage: boolean;
  // The subject holds nothing the caller does not, so a write may be offered.
  withinReach: boolean;
  self: boolean;
}

// One panel per tab, in SUBJECT_TABS' order; a tab joins by naming its panel here.
const PANELS: Readonly<Record<SubjectTab, (props: PanelProps) => ReactNode>> = {
  profile: (props) => <ProfileTab {...props} />,
  credentials: (props) => <CredentialsTab {...props} />,
  groups: (props) => (
    <GroupsTab
      tenant={props.tenant}
      subject={props.subject}
      canManage={props.canManage}
      self={props.self}
    />
  ),
  roles: (props) => (
    <RolesTab
      tenant={props.tenant}
      subject={props.subject}
      canManage={props.canManage}
      self={props.self}
    />
  ),
  'required-actions': (props) => (
    <RequiredActionsTab tenant={props.tenant} subject={props.subject} canManage={props.canManage} />
  ),
  sessions: (props) => (
    <SessionsTab
      tenant={props.tenant}
      subject={props.subject}
      self={props.self}
      withinReach={props.withinReach}
    />
  ),
  consents: (props) => (
    <ConsentsTab tenant={props.tenant} subject={props.subject} canManage={props.canManage} />
  ),
  grants: (props) => (
    <GrantsTab
      tenant={props.tenant}
      subject={props.subject}
      self={props.self}
      withinReach={props.withinReach}
    />
  ),
  activity: (props) => <ActivityPanel tenant={props.tenant} id={props.subject.id} />,
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
          withinReach: page.reach === 'ready' && page.beyond.length === 0,
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
      {...(page.changeNeeds.length > 0 || page.beyond.length > 0 || typeof page.reach === 'object'
        ? {
            viewOnly: (
              <>
                {page.changeNeeds.length > 0 ? (
                  <ViewOnlyNote noun="subjects" needs={page.changeNeeds} />
                ) : null}
                {page.beyond.length > 0 ? <BeyondNote name={name} beyond={page.beyond} /> : null}
                {typeof page.reach === 'object' ? (
                  <ReachFailed name={name} retry={page.reach.retry} />
                ) : null}
              </>
            ),
          }
        : {})}
      readOnly={!page.canManage}
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
