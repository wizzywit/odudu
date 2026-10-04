import type { Role } from '@odudu/contracts/admin';
import type { PickerState } from '#/shared/service/picker.ts';
import { Picker } from '#/shared/view/Picker.tsx';

// A client role is carried in a token under its client's name, so two roles
// of one name are told apart by their owner, spoken as well as shown.
function owner(role: Role): string | null {
  if (role.client_id === null) return null;
  return role.client_key ?? role.client_id;
}

export function RolePicker({
  label,
  picker,
  selected,
  onChange,
  selectionMode = 'multiple',
}: {
  label: string;
  picker: PickerState<Role>;
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  selectionMode?: 'single' | 'multiple';
}) {
  return (
    <Picker
      label={label}
      noun={{ one: 'role', other: 'roles' }}
      picker={picker}
      idOf={(role) => role.id}
      nameOf={(role) => role.name}
      detailOf={(role) => {
        const client = owner(role);
        return client === null ? 'tenant role' : `client ${client}`;
      }}
      accessibleNameOf={(role) => {
        const client = owner(role);
        return client === null
          ? `${role.name}, a tenant role`
          : `${role.name}, a role of client ${client}`;
      }}
      capability="view-users"
      selected={selected}
      onChange={onChange}
      selectionMode={selectionMode}
    />
  );
}
