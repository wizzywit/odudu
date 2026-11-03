export interface ScopeCount {
  count: number;
  capped: boolean;
}

// What deleting the scope would take with it.
export interface ScopeImpact {
  builtin: boolean;
  client_assignments: ScopeCount;
  role_mappings: ScopeCount;
}
