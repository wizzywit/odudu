import type { Group } from '@odudu/contracts/admin';
import type { PickerState } from '#/shared/service/picker.ts';
import { Picker } from '#/shared/view/Picker.tsx';

export function GroupPicker({
  label,
  picker,
  selected,
  onChange,
  selectionMode = 'multiple',
}: {
  label: string;
  picker: PickerState<Group>;
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  selectionMode?: 'single' | 'multiple';
}) {
  return (
    <Picker
      label={label}
      noun={{ one: 'group', other: 'groups' }}
      picker={picker}
      idOf={(group) => group.id}
      nameOf={(group) => group.name}
      detailOf={(group) => group.path}
      capability="view-users"
      selected={selected}
      onChange={onChange}
      selectionMode={selectionMode}
    />
  );
}
