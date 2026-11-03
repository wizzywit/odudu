import {
  useSubjectGroups,
  useSubjectGroupsRead,
  type Membership,
  type SubjectGroups,
} from '#/pages/subjects/use-cases/useSubjectGroups';
import { AskedDialog } from '#/shared/ui/ConfirmDialog';
import { GroupPicker } from '#/shared/ui/GroupPicker';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { recordTab } from '#/shared/ui/RecordTab';
import { type Subject } from '#/entities/subject';

export function Memberships({ name, members }: { name: string; members: readonly Membership[] }) {
  if (members.length === 0)
    return <p className={recordTab.rule}>{`${name} belongs to no group.`}</p>;
  return (
    <ul aria-label={`${name} belongs to`} className={recordTab.list}>
      {members.map((member) => (
        <li key={member.id}>
          <code>{member.path}</code>
          {member.description === null ? null : (
            <span className={recordTab.rule}>{` · ${member.description}`}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Groups({ groups }: { groups: SubjectGroups }) {
  const s = groups.save;
  return (
    <SaveSection
      title="Groups"
      description="Direct memberships, which the groups claim of the next token carries. Joining a group grants its roles, and its ancestors' roles too."
      save={s}
    >
      <Memberships name={groups.name} members={groups.members} />
      {groups.canManage ? (
        <GroupPicker
          label={`Groups ${groups.name} belongs to`}
          picker={groups.picker}
          selected={s.values.group_ids}
          onChange={groups.choose}
        />
      ) : null}
      <AskedDialog
        asked={groups.confirming}
        confirmLabel="Save Groups"
        onConfirm={groups.confirm}
        onCancel={groups.cancel}
      />
    </SaveSection>
  );
}

function Ready({
  tenant,
  subject,
  canManage,
  self,
  ...read
}: {
  tenant: string;
  subject: Subject;
  canManage: boolean;
  self: boolean;
  data: Parameters<typeof useSubjectGroups>[2];
  etag: string;
  gone: boolean;
}) {
  const groups = useSubjectGroups(
    tenant,
    subject,
    read.data,
    read.etag,
    read.gone,
    canManage,
    self,
  );
  return <Groups groups={groups} />;
}

export function GroupsTab({
  tenant,
  subject,
  canManage,
  self,
}: {
  tenant: string;
  subject: Subject;
  canManage: boolean;
  self: boolean;
}) {
  const read = useSubjectGroupsRead(tenant, subject.id);
  return (
    <ReadGate
      read={read}
      label="Loading the groups"
      fields={2}
      failed="The groups could not be loaded"
    >
      {(data, etag) => (
        <div className={recordTab.tab}>
          <Ready
            tenant={tenant}
            subject={subject}
            canManage={canManage}
            self={self}
            data={data}
            etag={etag}
            gone={read.gone}
          />
        </div>
      )}
    </ReadGate>
  );
}
