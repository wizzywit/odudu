import type { Role } from '@odudu/contracts/admin';
import { NAME_FIXED } from '#/features/roles/services/roleCopy';
import {
  useRoleGeneral,
  type Defaults,
  type Deletion,
  type RoleGeneral,
} from '#/features/roles/use-cases/useRoleGeneral';
import type { RoleCeiling } from '#/features/roles/use-cases/useRoleRecordPage';
import { DeleteZone } from '#/shared/ui/DeleteZone';
import { DescriptionField } from '#/shared/ui/DescriptionField';
import { Panel } from '#/shared/ui/Panel';
import { RoleOwner } from '#/shared/ui/RoleOwner';
import { ToggleField } from '#/shared/ui/Field';
import { SaveSection } from '#/shared/ui/SaveSection';
import { Timestamp } from '#/shared/ui/Timestamp';
import { recordTab } from '#/shared/ui/RecordTab';

function Fixed({ role }: { role: Role }) {
  return (
    <Panel title="Name">
      <dl className={recordTab.fixed}>
        <div>
          <dt>Name</dt>
          <dd>
            <code>{role.name}</code>
          </dd>
        </div>
        <div>
          <dt>Belongs to</dt>
          <dd>
            <RoleOwner role={role} />
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <Timestamp value={role.created_at} />
          </dd>
        </div>
      </dl>
      <p className={recordTab.rule}>{NAME_FIXED}</p>
    </Panel>
  );
}

function Description({ general }: { general: RoleGeneral }) {
  const s = general.description;
  return (
    <SaveSection
      title="Description"
      description="What the role is for, shown wherever it is chosen."
      save={s}
    >
      <DescriptionField save={s} rule={general.descriptionRule} limit={general.descriptionLimit} />
    </SaveSection>
  );
}

function DefaultSection({ defaults }: { defaults: Defaults }) {
  const s = defaults.save;
  let body;
  if (defaults.fixed !== null) {
    body = <p className={recordTab.rule}>{defaults.fixed}</p>;
  } else if (defaults.checking) {
    body = <p className={recordTab.rule}>Checking what it nests…</p>;
  } else {
    body = (
      <ToggleField
        label="Given to every new subject"
        description="Every subject created from now on is given it, by the admin API, registration and seeding alike. Nobody who already exists is changed, and turning it off takes it from nobody."
        value={s.values.default_for_new_subjects}
        changed={s.changed.includes('default_for_new_subjects')}
        onChange={(value) => {
          s.edit('default_for_new_subjects', value);
        }}
      />
    );
  }
  return (
    <SaveSection title="New subjects" save={s}>
      {body}
    </SaveSection>
  );
}

// Left out where the ceiling rules it out, which the page's one line says.
function Danger({ name, deletion }: { name: string; deletion: Deletion }) {
  if (deletion.held) return null;
  let note;
  if (deletion.fixed !== null) note = <p className={recordTab.rule}>{deletion.fixed}</p>;
  else if (deletion.checking) note = <p className={recordTab.rule}>Checking what it nests…</p>;
  return (
    <DeleteZone name={name} deletion={deletion} consequence={deletion.consequence} note={note} />
  );
}

export function GeneralTab({
  tenant,
  role,
  etag,
  gone,
  ceiling,
}: {
  tenant: string;
  role: Role;
  etag: string;
  gone: boolean;
  ceiling: RoleCeiling;
}) {
  const general = useRoleGeneral({ tenant, role, etag, gone, ceiling });
  return (
    <div className={recordTab.tab}>
      <Fixed role={role} />
      <Description general={general} />
      <DefaultSection defaults={general.defaults} />
      <Danger name={role.name} deletion={general.deletion} />
    </div>
  );
}
