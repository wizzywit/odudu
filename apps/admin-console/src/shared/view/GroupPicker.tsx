import type { Group } from '@odudu/contracts/admin';
import type { PickerState } from '#/shared/service/picker.ts';
import { Picker } from '#/shared/view/Picker.tsx';

export function GroupPicker({
  label,
  picker,
  selected,
  onChange,
  selectionMode = 'multiple',
  unavailableOf,
}: {
  label: string;
  picker: PickerState<Group>;
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  selectionMode?: 'single' | 'multiple';
  // Why a group cannot be chosen here, or null when it can.
  unavailableOf?: (group: Group) => string | null;
}) {
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
