import { Picker, type PickerFieldProps } from '#/shared/ui/Picker';
import type { Group } from '#/entities/group/types/group';

export function GroupPicker({
  label,
  picker,
  selected,
  onChange,
  selectionMode = 'multiple',
  unavailableOf,
}: PickerFieldProps<Group>) {
  return (
    <Picker
      label={label}
      noun={{ one: 'group', other: 'groups' }}
      picker={picker}
      idOf={(group) => group.id}
      nameOf={(group) => group.name}
      detailOf={(group) =>
        group.description === null || group.description === ''
          ? group.path
          : `${group.path} · ${group.description}`
      }
      capability="view-users"
      selected={selected}
      onChange={onChange}
      selectionMode={selectionMode}
      {...(unavailableOf === undefined ? {} : { unavailableOf })}
    />
  );
}
