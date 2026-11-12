import { type Database, type RequestContext, type TenantScopedDatabase } from '@odudu/db';
import { type BreachedCheckOutcome } from '@odudu/domain-audit';

export interface BreachedVerdict {
  readonly audit: BreachedCheckOutcome;
  // Empty to accept; otherwise the rules to list beside the other policy rules.
  readonly violations: readonly { rule: string; message: string }[];
}

// What `prepare` learned, handed back to `judge` unread: only the check
// knows what is in it.
export type BreachedPrepared = object;

// Asks whether a candidate that passed the tenant's other rules is a password
// known from breaches. `prepare` runs before the writing transaction opens,
// so no pooled connection is held while a remote service answers; `judge`
// runs inside it. Injected for the reason the rules are: @odudu/account never
// imports @odudu/domain-identity, where the dataset lives.
export interface BreachedCheck {
  prepare(
    database: Database,
    tenantId: string,
    password: string,
    request?: RequestContext,
  ): Promise<BreachedPrepared>;
  judge(
    tx: TenantScopedDatabase,
    tenantId: string,
    password: string,
    prepared: BreachedPrepared,
  ): Promise<BreachedVerdict>;
  // Both, for a writer with no transaction open.
  run(
    database: Database,
    tenantId: string,
    password: string,
    request?: RequestContext,
  ): Promise<BreachedVerdict>;
}
