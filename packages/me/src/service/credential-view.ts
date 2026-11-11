import type { CredentialSummary } from '@odudu/domain-identity';

export type ShownCredentialType = 'password' | 'totp' | 'webauthn';

export interface CredentialView {
  readonly id: string;
  readonly type: ShownCredentialType;
  readonly label: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

function shown(type: CredentialSummary['type']): ShownCredentialType | null {
  return type === 'password' || type === 'totp' || type === 'webauthn' ? type : null;
}

// Copies the named fields and nothing else, so a column added to the row
// later reaches no response by being there. Null for a kind a person is not
// shown: recovery codes are counted, retired passwords answer nothing.
export function credentialView(row: CredentialSummary): CredentialView | null {
  const type = shown(row.type);
  if (type === null) return null;
  return {
    id: row.id,
    type,
    label: row.label,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export function credentialViews(rows: readonly CredentialSummary[]): CredentialView[] {
  return rows.flatMap((row) => credentialView(row) ?? []);
}
