import { Picker, type PickerFieldProps } from '#/shared/ui/Picker';
import { roleAccessibleName, roleDetail } from '#/entities/role/use-cases/roleOption';
import type { Role } from '#/entities/role/types/role';

export function RolePicker({
  label,
  picker,
  selected,
  onChange,
  selectionMode = 'multiple',
  unavailableOf,
}: PickerFieldProps<Role>) {
  return (
    <Picker
      label={label}
      noun={{ one: 'role', other: 'roles' }}
      picker={picker}
      idOf={(role) => role.id}
      nameOf={(role) => role.name}
      detailOf={roleDetail}
      accessibleNameOf={roleAccessibleName}
      capability="view-users"
      selected={selected}
      onChange={onChange}
      selectionMode={selectionMode}
      {...(unavailableOf === undefined ? {} : { unavailableOf })}
    />
  );
}
