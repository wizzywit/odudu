import type { GroupRecord } from '@odudu/contracts/admin';
import type { ReactNode } from 'react';
import { AreaGate, areaAt } from '#/features/shell/index.ts';
import { SubjectMembers } from '#/features/subjects/index.ts';
import {
  GROUP_TAB_LABELS,
  GROUP_TABS,
  groupsTrail,
  type GroupTab,
} from '#/features/groups/service.ts';
import { useAuditReadable, useGroupActivity } from '#/features/groups/usecase/useGroupActivity.ts';
import { useGroupRecordPage, type Ceiling } from '#/features/groups/usecase/useGroupRecordPage.ts';
import { GeneralTab } from '#/features/groups/view/GeneralTab.tsx';
import { RolesTab } from '#/features/groups/view/RolesTab.tsx';
import { ActivityTab } from '#/shared/view/ActivityTab.tsx';
import { Button } from '#/shared/view/Button';
import { ButtonLink } from '#/shared/view/ButtonLink.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { RecordPage } from '#/shared/view/RecordPage.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import noteStyles from '#/shared/view/CapabilityNote.module.css';
import styles from '#/features/groups/view/Tab.module.css';

interface PanelProps {
  tenant: string;
  group: GroupRecord;
  etag: string;
  gone: boolean;
  ceiling: Ceiling;
}

function Trail({ tenant, id }: { tenant: string; id: string }) {
  const list = useGroupActivity(tenant, id);
  return <ActivityTab list={list} noun="group" />;
}

function Activity({ tenant, id }: { tenant: string; id: string }) {
  const readable = useAuditReadable(tenant);
  return (
    <div className={styles.tab}>
      <p className={styles.rule}>
        Every change made to this group, and every change refused. A subject joining or leaving it
        is filed under that subject.
      </p>
      {readable ? (
        <Trail tenant={tenant} id={id} />
      ) : (
        <CapabilityNote capability="view-audit">Activity</CapabilityNote>
      )}
    </div>
  );
}

// One panel per tab, in GROUP_TABS' order.
const PANELS: Readonly<Record<GroupTab, (props: PanelProps) => ReactNode>> = {
  general: (props) => <GeneralTab {...props} />,
  roles: (props) => <RolesTab tenant={props.tenant} group={props.group} ceiling={props.ceiling} />,
  members: (props) => (
    <SubjectMembers tenant={props.tenant} by="group" id={props.group.id} name={props.group.path} />
  ),
  activity: (props) => <Activity tenant={props.tenant} id={props.group.id} />,
};

// The one line under the header: what the ceiling rules out here, or that it
// could not be judged.
function Lines({ ceiling }: { ceiling: Ceiling }) {
  if (ceiling.status === 'failed') {
    return (
      <p role="note" className={noteStyles.note}>
        What this group hands out could not be read, so no move, delete or role change is offered
        until it is.{' '}
        <Button size="small" variant="quiet" onPress={ceiling.retry}>
          Read it again
        </Button>
      </p>
    );
  }
  if (ceiling.status !== 'ready') return null;
  const lines = [ceiling.lines.move, ceiling.lines.remove].filter((line) => line !== null);
  if (lines.length === 0) return null;
  return (
    <p role="note" className={noteStyles.note}>
      {lines.join(' ')}
    </p>
  );
}

function Record({ tenant, id }: { tenant: string; id: string }) {
  const page = useGroupRecordPage(tenant, id);
  const { group, etag } = page;
  const title = group?.path ?? 'Group';
  const props: PanelProps | null =
    group === undefined || etag === null
      ? null
      : { tenant, group, etag, gone: page.record.gone, ceiling: page.ceiling };
  return (
    <RecordPage
      record={page.record}
      breadcrumb={groupsTrail(tenant, title)}
      title={title}
      {...(group?.default_for_new_subjects === true
        ? { status: <StatusTag tone="active">joined by every new subject</StatusTag> }
        : {})}
      {...(group?.description == null ? {} : { description: group.description })}
      {...(page.createUnderHref === null
        ? {}
        : {
            actions: (
              <ButtonLink href={page.createUnderHref} size="small">
                {`Create a group under ${title}`}
              </ButtonLink>
            ),
          })}
      noun="group"
      viewOnly={<Lines ceiling={page.ceiling} />}
      readOnly={false}
      label="Group sections"
      tab={page.tab}
      onTabChange={page.selectTab}
      tabs={GROUP_TABS.map((tab) => ({
        id: tab,
        label: GROUP_TAB_LABELS[tab],
        dirty: page.dirty.has(tab),
        panel: props === null ? null : PANELS[tab](props),
      }))}
    />
  );
}

export function GroupRecordPage({ tenant, id }: { tenant: string; id: string }) {
  return (
    <AreaGate
      tenant={tenant}
      area={areaAt('groups')}
      title="Group"
      breadcrumb={groupsTrail(tenant, 'Group')}
    >
      <Record tenant={tenant} id={id} />
    </AreaGate>
  );
}
