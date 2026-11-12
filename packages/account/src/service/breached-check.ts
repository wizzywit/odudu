import { type TenantScopedDatabase } from '@odudu/db';
import { type BreachedCheckOutcome } from '@odudu/domain-audit';

export interface BreachedVerdict {
  readonly audit: BreachedCheckOutcome;
  // Empty to accept; otherwise the rules to list beside the other policy rules.
  readonly violations: readonly { rule: string; message: string }[];
}

// Asks whether a candidate that passed the tenant's other rules is a password
// known from breaches. Injected for the reason the rules are:
// @odudu/account never imports @odudu/domain-identity, where the dataset lives.
export type BreachedCheck = (
  tx: TenantScopedDatabase,
  tenantId: string,
  password: string,
) => Promise<BreachedVerdict>;
