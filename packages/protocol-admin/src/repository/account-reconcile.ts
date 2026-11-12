import { type TenantScopedDatabase } from '@odudu/db';
import { type CredentialType } from '@odudu/domain-identity';
import { sql, type SQL } from 'drizzle-orm';
import { type AccountRecord } from '#/service/reconcile-accounts';

interface MemberRow {
  subject_id: string;
  email: string | null;
  email_verified: boolean;
  created_at: Date;
  session: boolean;
  grant_exists: boolean;
  used_credential: boolean;
  login_event: boolean;
}

const SIGN_IN_ACTIONS = [
  'login.password',
  'login.otp',
  'login.recovery_code',
  'login.passkey',
  'session.created',
] as const;

// Every statement names the tenant itself as well as running under its
// row-level policy, so a call made with another tenant's ids finds nothing
// even on a connection that bypasses the policy.
export function accountReconcileRepository(tx: TenantScopedDatabase, tenantId: string) {
  return {
    /**
     * Up to `limit` addresses, in key order after `after`, that more than one
     * account holds, compared as `users.email_search` is. One walk of
     * `users_email_search`; the keyset is the address, so a page costs the
     * rows it passes and nothing is held between pages.
     */
    async duplicateAddresses(after: string | null, limit: number): Promise<string[]> {
      const past: SQL = after === null ? sql`` : sql`and email_search > ${after} collate "C"`;
      const rows = await tx.execute(sql`
        select email_search as address
          from users
         where tenant_id = ${tenantId} and email_search is not null ${past}
         group by email_search
        having count(*) > 1
         order by email_search
         limit ${limit}`);
      return (rows as unknown as { address: string }[]).map((row) => row.address);
    },

    /**
     * The accounts that hold `address`, locked in id order for the rest of
     * the transaction, with what a sign-in leaves behind for each: a
     * session, a grant, a used credential, and an audit row recording a
     * successful sign-in by the account. The audit probe is one index read
     * of `audit_events_actor` that stops at its first match, and the
     * reaper and audit retention can both have removed an old sign-in.
     */
    async lockAccounts(address: string): Promise<AccountRecord[]> {
      const rows = await tx.execute(sql`
        select u.subject_id, u.email, u.email_verified, s.created_at,
               exists (select 1 from sessions x
                        where x.tenant_id = ${tenantId} and x.subject_id = u.subject_id) as session,
               exists (select 1 from token_grants g
                        where g.tenant_id = ${tenantId} and g.subject_id = u.subject_id)
                 as grant_exists,
               exists (select 1 from user_credentials c
                        where c.tenant_id = ${tenantId} and c.subject_id = u.subject_id
                          and c.last_used_at is not null) as used_credential,
               exists (select 1 from audit_events e
                        where e.tenant_id = ${tenantId} and e.actor_subject_id = u.subject_id
                          and e.outcome = 'allowed'
                          and e.action in (${sql.join(
                            SIGN_IN_ACTIONS.map((action) => sql`${action}`),
                            sql`, `,
                          )})) as login_event
          from users u
          join subjects s on s.id = u.subject_id and s.tenant_id = u.tenant_id
         where u.tenant_id = ${tenantId} and u.email_search = ${address} collate "C"
         order by u.subject_id
           for update of u
           for no key update of s`);
      return (rows as unknown as MemberRow[]).map((row) => ({
        subjectId: row.subject_id,
        email: row.email,
        createdAt: new Date(row.created_at),
        emailVerified: row.email_verified,
        traces: {
          session: row.session,
          grant: row.grant_exists,
          usedCredential: row.used_credential,
          loginEvent: row.login_event,
        },
      }));
    },

    // A mailed link or a pending address of the account that goes would
    // otherwise be completable later; the account is disabled as well.
    async clearPendingLinks(subjectId: string): Promise<void> {
      await tx.execute(sql`
        delete from action_tokens where tenant_id = ${tenantId} and subject_id = ${subjectId}`);
      await tx.execute(sql`
        delete from pending_email_changes
         where tenant_id = ${tenantId} and subject_id = ${subjectId}`);
    },

    async credentialTypes(subjectId: string): Promise<Set<CredentialType>> {
      const rows = await tx.execute(sql`
        select distinct type from user_credentials
         where tenant_id = ${tenantId} and subject_id = ${subjectId}`);
      return new Set((rows as unknown as { type: CredentialType }[]).map((row) => row.type));
    },

    async moveCredentials(
      from: string,
      to: string,
      types: readonly CredentialType[],
    ): Promise<number> {
      if (types.length === 0) return 0;
      const list = sql.join(
        types.map((type) => sql`${type}`),
        sql`, `,
      );
      const result = await tx.execute(sql`
        update user_credentials set subject_id = ${to}
         where tenant_id = ${tenantId} and subject_id = ${from} and type in (${list})`);
      return result.count;
    },

    // The bound on replacing a set reads the time it was made from the
    // subject, so the time travels with a set that moves.
    async moveRecoveryCodeStamp(from: string, to: string): Promise<void> {
      await tx.execute(sql`
        update subjects
           set recovery_codes_issued_at =
                 (select recovery_codes_issued_at from subjects
                   where tenant_id = ${tenantId} and id = ${from})
         where tenant_id = ${tenantId} and id = ${to}`);
    },

    async moveSessions(from: string, to: string): Promise<number> {
      const result = await tx.execute(sql`
        update sessions set subject_id = ${to}
         where tenant_id = ${tenantId} and subject_id = ${from}`);
      return result.count;
    },

    async moveGrants(from: string, to: string): Promise<number> {
      const result = await tx.execute(sql`
        update token_grants set subject_id = ${to}
         where tenant_id = ${tenantId} and subject_id = ${from}`);
      return result.count;
    },

    // A client the survivor already consented to keeps the survivor's own.
    async moveConsents(from: string, to: string, now: Date): Promise<number> {
      const result = await tx.execute(sql`
        update consents set subject_id = ${to}, updated_at = ${now.toISOString()}::timestamptz
         where tenant_id = ${tenantId} and subject_id = ${from}
           and client_id not in (select client_id from consents
                                  where tenant_id = ${tenantId} and subject_id = ${to})`);
      return result.count;
    },
  };
}
