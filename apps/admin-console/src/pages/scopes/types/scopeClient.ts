import type { ScopeAssignment } from '#/entities/scope';

// A client named by its row id, `client_id` and name: nothing of its configuration.
export interface ScopeClient {
  id: string;
  client_id: string;
  name: string;
  assignment: ScopeAssignment;
}

export interface ScopeClientList {
  items: ScopeClient[];
  next?: string | undefined;
}
