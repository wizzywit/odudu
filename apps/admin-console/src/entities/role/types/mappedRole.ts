// A role a group or a scope hands on, with whose it is.
export interface MappedRole {
  id: string;
  name: string;
  client_id: string | null;
  client_key: string | null;
  description: string | null;
}
