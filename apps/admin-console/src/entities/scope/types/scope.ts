export type ScopeAssignment = 'default' | 'optional';

export interface Scope {
  id: string;
  name: string;
  description: string | null;
  include_in_id_token: boolean;
  include_in_access_token: boolean;
  // How a client created afterwards is assigned it; null when it is not.
  default_client_assignment: ScopeAssignment | null;
  consent_text: string | null;
  description_i18n: Record<string, string>;
  consent_text_i18n: Record<string, string>;
  display_order: number;
  created_at: string;
}

// A client's scope assignments alone, which is all `manage-tenant` may be told of it.
export interface AssignedScopes {
  client_id: string;
  scopes: { id: string; name: string; assignment: ScopeAssignment }[];
}
