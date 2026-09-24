import { clientScopeSchema } from '@odudu/contracts/admin';

// The real field list a scope's wire shape carries, not a hand-kept
// restatement of it — a field added to `clientScopeSchema`
// (@odudu/contracts) shows up here without this file changing, so the
// "accounts for every field" test below (scope-patch.test.ts) actually
// exercises the contract rather than a copy of it.
export const SCOPE_FIELDS: readonly string[] = Object.keys(clientScopeSchema.shape);

const REFUSALS: Readonly<Record<string, string>> = {
  id: 'identity: changing it breaks every client_scope_assignments and client_scope_roles edge naming this scope',
  name: 'name is the scope token a client requests and a token carries; renaming it needs its own operation, not a general amendment',
  created_at: 'created_at is history',
};

export function refusalFor(field: string): string | null {
  return REFUSALS[field] ?? null;
}

export const AMENDABLE_SCOPE_FIELDS: readonly string[] = SCOPE_FIELDS.filter(
  (field) => refusalFor(field) === null,
);
