import type { Client } from '#/entities/client/types/client';
import { Picker, type PickerFieldProps } from '#/shared/ui/Picker';

type ClientOption = Pick<Client, 'id' | 'name' | 'client_id' | 'type'>;

// The client id is what a person knows an application by, and two clients
// can share a name, so each option carries both.
export function ClientPicker({
  label,
  picker,
  selected,
  onChange,
  selectionMode = 'multiple',
  unavailableOf,
}: PickerFieldProps<ClientOption>) {
  return (
    <Picker
      label={label}
      noun={{ one: 'client', other: 'clients' }}
      picker={picker}
      idOf={(client) => client.id}
      nameOf={(client) => client.name}
      detailOf={(client) => `${client.client_id} · ${client.type}`}
      capability="manage-clients"
      selected={selected}
      onChange={onChange}
      selectionMode={selectionMode}
      {...(unavailableOf === undefined ? {} : { unavailableOf })}
    />
  );
}
