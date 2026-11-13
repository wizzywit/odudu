import type { CredentialSummary, UserRecord } from '@odudu/domain-identity';
import type { SubjectConsent } from '@odudu/domain-tenant';
import type { MeSessionLifespans, MeSessionRecord } from '#/service/session-view';

export interface Page {
  readonly after: string | undefined;
  readonly limit: number;
}

// Every read of the "me" API, for the subject the token names and nobody else.
// Each takes the tenant it runs in and returns only that tenant's rows. A page
// is one list read in id order (consents, by client_id), so a request makes a
// constant number of queries.
export interface MeReads {
  profile(tenantId: string, subjectId: string): Promise<UserRecord | null>;
  credentials(
    tenantId: string,
    subjectId: string,
    page: Page,
  ): Promise<{
    readonly rows: readonly CredentialSummary[];
    readonly recoveryCodesLeft: number;
    // Recovery codes held, spent or not: zero is a person with no set.
    readonly recoveryCodesHeld: number;
    // The tenant's `recovery_code_warn_below`.
    readonly recoveryCodeWarnBelow: number;
  }>;
  sessions(
    tenantId: string,
    subjectId: string,
    lifespans: MeSessionLifespans,
    now: Date,
    page: Page,
  ): Promise<readonly MeSessionRecord[]>;
  consents(tenantId: string, subjectId: string, page: Page): Promise<readonly SubjectConsent[]>;
}
