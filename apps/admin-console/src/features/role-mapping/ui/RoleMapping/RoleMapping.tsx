import type { ReactNode } from 'react';
import { MappedRoles, RolePicker, type RoleValues } from '#/entities/role';
import type { RoleMappingModel } from '#/features/role-mapping/use-cases/useRoleMapping';
import { recordTab } from '#/shared/ui/RecordTab';
import { SaveSection } from '#/shared/ui/SaveSection';

type Save = Parameters<typeof SaveSection>[0]['save'] & { values: RoleValues };

// The editor of the roles a group or a scope carries. `save` is passed
// beside the mapping because a page may gate it; `children` is what only one
// side adds, after the notes.
export function RoleMapping({
  name,
  description,
  empty,
  mapping,
  save,
  afterPicker,
  children,
}: {
  name: string;
  description: string;
  // What to say when no role is mapped, in place of the plain statement.
  empty?: string | undefined;
  mapping: RoleMappingModel;
  save: Save;
  // What one side adds between the picker and the kept-roles note.
  afterPicker?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SaveSection title="Roles" description={description} save={save}>
      <MappedRoles name={name} mapped={mapping.mapped} empty={empty} />
      {mapping.offered ? (
        <RolePicker
          label={`Roles ${name} carries`}
          picker={mapping.picker}
          selected={save.values.role_ids}
          unavailableOf={mapping.unavailableOf}
          onChange={mapping.choose}
        />
      ) : (
        <p className={recordTab.rule}>Checking what you may give or take here…</p>
      )}
      {afterPicker}
      {mapping.kept.length === 0 ? null : (
        <p className={recordTab.rule}>
          A role you could not give is one you cannot take away either, so it stays whatever else is
          saved.
        </p>
      )}
      {children}
    </SaveSection>
  );
}
