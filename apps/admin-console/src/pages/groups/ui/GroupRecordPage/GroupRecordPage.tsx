import type { ReactNode } from 'react';
import { useAuditReadable } from '#/entities/session';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { SubjectMembers } from '#/features/subject-members';
import { type GroupRecord, groupsTrail } from '#/entities/group';
import type { GroupTab } from '#/pages/groups/services/tabs';
import { useGroupRecordPage, type GroupCeiling } from '#/pages/groups/use-cases/useGroupRecordPage';
import { GeneralTab } from '#/pages/groups/ui/GroupRecordPage/GeneralTab';
import { RolesTab } from '#/pages/groups/ui/GroupRecordPage/RolesTab';
import { Button } from '#/shared/ui/Button';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { RecordActivity } from '#/shared/ui/RecordActivity';
import { RecordPage, type RecordPanelProps } from '#/shared/ui/RecordPage';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Note } from '#/shared/ui/Note';

type PanelProps = RecordPanelProps<'group', GroupRecord> & {
  ceiling: GroupCeiling;
};

function Activity({ tenant, id }: { tenant: string; id: string }) {
  const readable = useAuditReadable(tenant);
  return (
    <RecordActivity
      resource="group"
      tenant={tenant}
      id={id}
      lead="Every change made to this group, and every change refused. A subject joining or leaving it is filed under that subject."
      readable={readable}
    />
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
function Lines({ ceiling }: { ceiling: GroupCeiling }) {
  if (ceiling.status === 'failed') {
    return (
      <Note>
        What this group hands out could not be read, so no move, delete or role change is offered
        until it is.{' '}
        <Button size="small" variant="quiet" onPress={ceiling.retry}>
          Read it again
        </Button>
      </Note>
    );
  }
  if (ceiling.status !== 'ready') return null;
  const lines = [ceiling.lines.move, ceiling.lines.remove].filter((line) => line !== null);
  if (lines.length === 0) return null;
  return <Note>{lines.join(' ')}</Note>;
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
      tabs={page.tabList.map(({ id, label, dirty }) => ({
        id,
        label,
        dirty,
        panel: props === null ? null : PANELS[id](props),
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
