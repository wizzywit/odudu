import type { ReactNode } from 'react';
import {
  SUBJECT_TAB_LABELS,
  SUBJECT_TABS,
  subjectName,
  subjectsTrail,
  type Subject,
  type SubjectTab,
} from '#/features/subjects/services';
import { useSubjectRecordPage } from '#/features/subjects/use-cases/useSubjectRecordPage';
import { ActivityPanel } from '#/features/subjects/ui/SubjectRecordPage/ActivityPanel';
import { ConsentsTab } from '#/features/subjects/ui/SubjectRecordPage/ConsentsTab';
import { GrantsTab } from '#/features/subjects/ui/SubjectRecordPage/GrantsTab';
import { SessionsTab } from '#/features/subjects/ui/SubjectRecordPage/SessionsTab';
import { CredentialsTab } from '#/features/subjects/ui/SubjectRecordPage/CredentialsTab';
import { GroupsTab } from '#/features/subjects/ui/SubjectRecordPage/GroupsTab';
import { RequiredActionsTab } from '#/features/subjects/ui/SubjectRecordPage/RequiredActionsTab';
import { RolesTab } from '#/features/subjects/ui/SubjectRecordPage/RolesTab';
import { ProfileTab } from '#/features/subjects/ui/SubjectRecordPage/ProfileTab';
import { SubjectsGate } from '#/features/subjects/ui/SubjectsGate';
import { RecordPage } from '#/shared/ui/RecordPage';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';
import { BeyondNote, ReachFailed } from '#/features/subjects/ui/BeyondNote';

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
            status: <EnabledTag enabled={subject.enabled} />,
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
