const DERIVED = new Set(['admin_reach', 'subtree_admin_reach']);

// A role's or a group's answer without what is derived on each read: what
// its ETag is taken over.
export function storedFields(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([field]) => !DERIVED.has(field)));
}
