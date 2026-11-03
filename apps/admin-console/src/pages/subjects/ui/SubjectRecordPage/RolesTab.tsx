import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import {
  useCapabilityEditor,
  useSubjectRolesRead,
} from '#/pages/subjects/use-cases/useCapabilities';
import { useSubjectRoles, type SubjectRoles } from '#/pages/subjects/use-cases/useSubjectRoles';
import { CapabilitySection } from '#/pages/subjects/ui/SubjectRecordPage/CapabilityEditor';
import { Panel } from '#/shared/ui/Panel';
import { PagedList } from '#/pages/subjects/ui/SubjectRecordPage/SessionsTab';
import { provenanceText } from '#/shared/services/capabilities';
import type { Column } from '#/shared/ui/DataTable';
import { ReadGate } from '#/shared/ui/ReadGate';
import { RolePicker } from '#/shared/ui/RolePicker';
import { SaveSection } from '#/shared/ui/SaveSection';
import { recordTab } from '#/shared/ui/RecordTab';
import { type Subject, roleOwnerOf } from '#/entities/subject';

const EFFECTIVE: readonly Column<EffectiveRoleAssignment>[] = [
  { id: 'name', header: 'Role', isRowHeader: true, cell: (role) => <code>{role.name}</code> },
  { id: 'owner', header: 'Belongs to', cell: (role) => roleOwnerOf(role.client_key) },
  { id: 'how', header: 'Held', cell: (role) => role.via.map(provenanceText).join(', ') },
];

function Effective({ roles }: { roles: SubjectRoles }) {
  const body = (
    <PagedList
      list={roles.effective}
      label={`Every role ${roles.name} holds`}
      noun="roles held"
      columns={EFFECTIVE}
      rowKey={(role) => role.id}
      empty={`${roles.name} holds no role, directly or otherwise.`}
    />
  );
  return (
    <Panel title="Held, every way">
      <p className={recordTab.rule}>
        What a token and every authorisation read: the roles assigned here, those of every group and
        its ancestors, and each role nested inside another.
      </p>
      {body}
    </Panel>
  );
}

function Roles({ roles }: { roles: SubjectRoles }) {
  const s = roles.save;
  return (
    <SaveSection
      title="Roles"
      description="The roles assigned to the subject itself, other than its admin capabilities."
      save={s}
    >
      {roles.assigned.length === 0 ? (
        <p className={recordTab.rule}>{`${roles.name} is assigned no role here.`}</p>
      ) : (
        <ul aria-label={`Assigned to ${roles.name}`} className={recordTab.list}>
          {roles.assigned.map((role) => (
            <li key={role.id}>
              <code>{role.name}</code>
              <span className={recordTab.rule}>{` · ${roleOwnerOf(role.client)}`}</span>
            </li>
          ))}
        </ul>
      )}
      {roles.canManage ? (
        <RolePicker
          label={`Roles ${roles.name} holds directly`}
          picker={roles.picker}
          selected={s.values.role_ids}
          unavailableOf={roles.unavailableOf}
          onChange={roles.choose}
        />
      ) : null}
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
  data: Parameters<typeof useSubjectRoles>[2];
  etag: string;
  gone: boolean;
}) {
  const roles = useSubjectRoles(tenant, subject, read.data, read.etag, read.gone, canManage);
  const editing = useCapabilityEditor({ tenant, subject, allowed: canManage, self, ...read });
  return (
    <>
      <Roles roles={roles} />
      <CapabilitySection editing={editing} />
      <Effective roles={roles} />
    </>
  );
}

export function RolesTab({
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
  const read = useSubjectRolesRead(tenant, subject.id);
  return (
    <ReadGate
      read={read}
      label="Loading the roles"
      fields={3}
      failed="The roles could not be loaded"
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
