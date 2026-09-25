import { tenantSchema } from '@odudu/contracts/admin';

// The real field list a tenant's wire shape carries, not a hand-kept
// restatement of it — a field added to `tenantSchema` (@odudu/contracts)
// shows up here without this file changing, so the "accounts for every
// field" test below (tenant-patch.test.ts) actually exercises the contract
// rather than a copy of it.
export const TENANT_FIELDS: readonly string[] = Object.keys(tenantSchema.shape);

const REFUSALS: Readonly<Record<string, string>> = {
  id: 'identity: changing it orphans every row in the tenant and every cursor minted against it',
  name: 'name is already in the issuer URL of every token this tenant has minted, and in the path of every admin and protocol request addressed to it; renaming it needs its own operation, not a general amendment',
  created_at: 'created_at is history',
};

export function refusalFor(field: string): string | null {
  return REFUSALS[field] ?? null;
}

export const AMENDABLE_TENANT_FIELDS: readonly string[] = TENANT_FIELDS.filter(
  (field) => refusalFor(field) === null,
);
