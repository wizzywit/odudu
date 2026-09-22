import { type TenantScopedDatabase } from '@odudu/db';
import { newId, OduduError } from '@odudu/kernel';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  userCredentials,
  type CredentialRecord,
  type CredentialType,
} from '#/schema/user-credentials';
import {
  parseCredentialSecret,
  serializeCredentialSecret,
  type CredentialSecret,
} from '#/service/credential-secret';

export interface NewCredential {
  tenantId: string;
  subjectId: string;
  type: CredentialType;
  secret: CredentialSecret;
  label?: string;
  lookupKey?: string;
}

function toRecord(row: typeof userCredentials.$inferSelect): CredentialRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    subjectId: row.subjectId,
    type: row.type,
    secret: parseCredentialSecret(row.type, row.secretData),
    label: row.label,
    lastUsedAt: row.lastUsedAt,
    lookupKey: row.lookupKey,
    createdAt: row.createdAt,
  };
}

// The one place in this package where deleting a row is right. ADR 0021
// keeps a spent credential because a decision still reads it — a replayed
// recovery code is refused *as* a spent one. A retired password past the
// tenant's history depth is the opposite: no reuse check will ever compare
// against it again, so the row is a stored password hash that answers
// nothing, and keeping it is only exposure.
async function trimPasswordHistory(
  tx: TenantScopedDatabase,
  subjectId: string,
  historyDepth: number,
): Promise<void> {
  const beyondDepth = tx
    .select({ id: userCredentials.id })
    .from(userCredentials)
    .where(
      and(eq(userCredentials.subjectId, subjectId), eq(userCredentials.type, 'password-history')),
    )
    // created_at alone ties for two rows retired in one transaction, where
    // now() does not advance; the id breaks it so the set kept is the same
    // one on every run.
    .orderBy(desc(userCredentials.createdAt), desc(userCredentials.id))
    .offset(historyDepth);

  await tx
    .delete(userCredentials)
    .where(
      and(
        eq(userCredentials.subjectId, subjectId),
        eq(userCredentials.type, 'password-history'),
        inArray(userCredentials.id, beyondDepth),
      ),
    );
}

export function credentialRepository(tx: TenantScopedDatabase) {
  return {
    async passwordFor(subjectId: string): Promise<string | null> {
      const rows = await tx
        .select({ secretData: userCredentials.secretData })
        .from(userCredentials)
        .where(and(eq(userCredentials.subjectId, subjectId), eq(userCredentials.type, 'password')));
      const row = rows[0];
      if (row === undefined) return null;
      const secret = parseCredentialSecret('password', row.secretData);
      return secret.hash;
    },

    async listFor(subjectId: string, type: CredentialType): Promise<CredentialRecord[]> {
      const rows = await tx
        .select()
        .from(userCredentials)
        .where(and(eq(userCredentials.subjectId, subjectId), eq(userCredentials.type, type)));
      return rows.map(toRecord);
    },

    async byLookupKey(lookupKey: string): Promise<CredentialRecord | null> {
      const rows = await tx
        .select()
        .from(userCredentials)
        .where(eq(userCredentials.lookupKey, lookupKey));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // Called by the seed CLI and by `createAccount` in the registration route:
    // one credential row per call, typed by `input.type`, never a batch.
    async insert(input: NewCredential): Promise<void> {
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId: input.tenantId,
        subjectId: input.subjectId,
        type: input.type,
        secretData: serializeCredentialSecret(input.secret),
        label: input.label ?? null,
        lookupKey: input.lookupKey ?? null,
      });
    },

    async markUsed(id: string, at: Date): Promise<void> {
      const rows = await tx
        .update(userCredentials)
        .set({ lastUsedAt: at })
        .where(eq(userCredentials.id, id))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('credential_not_found', `no credential with id ${id}`);
      }
    },

    // RFC 6238 §5.2 forbids a second acceptance of an OTP that already
    // validated. The predicate on the stored step makes this the decision
    // rather than a record of one: two transactions that both read the same
    // pre-use `lastStep` serialize here, and the second re-checks the row
    // the first committed and matches nothing. Returns whether this call is
    // the one that spent the step — false is a verification failure, not a
    // missing credential, and the caller must refuse the code it accepted.
    async recordTotpUse(id: string, step: number, at: Date): Promise<boolean> {
      const rows = await tx
        .update(userCredentials)
        .set({
          secretData: sql`jsonb_set(${userCredentials.secretData}, '{lastStep}', to_jsonb(${step}::bigint))`,
          lastUsedAt: at,
        })
        .where(
          and(
            eq(userCredentials.id, id),
            eq(userCredentials.type, 'totp'),
            sql`coalesce((${userCredentials.secretData}->>'lastStep')::bigint, -1) < ${step}`,
          ),
        )
        .returning();
      return rows.length > 0;
    },

    // WebAuthn §6.1.1's clone check, as a compare-and-swap for the same
    // reason recordTotpUse is one: the predicate on the stored counter is
    // the decision, so two assertions replaying one counter value serialize
    // on the row and the second finds nothing to update. The zero case is
    // the exception §6.1.1 allows — an authenticator that never counts
    // reports zero forever, and refusing it refuses a conformant device.
    // Returns whether this call advanced it; false is an authentication
    // failure, not a missing credential.
    async advanceWebauthnCounter(id: string, counter: number, at: Date): Promise<boolean> {
      const stored = sql`coalesce((${userCredentials.secretData}->>'counter')::bigint, -1)`;
      const rows = await tx
        .update(userCredentials)
        .set({
          secretData: sql`jsonb_set(${userCredentials.secretData}, '{counter}', to_jsonb(${counter}::bigint))`,
          lastUsedAt: at,
        })
        .where(
          and(
            eq(userCredentials.id, id),
            eq(userCredentials.type, 'webauthn'),
            sql`(${stored} < ${counter} OR (${counter} = 0 AND ${stored} = 0))`,
          ),
        )
        .returning();
      return rows.length > 0;
    },

    // A recovery code is single-use, so the write is the decision and not a
    // record of one — the same compare-and-swap shape as recordTotpUse, for
    // the same reason: two submissions of one code serialize on the row and
    // the second finds a usedAt already set. The row is kept and marked
    // rather than deleted (ADR 0021), which is what lets a replay be refused
    // as a spent code instead of an unknown one. Returns whether this call
    // is the one that spent it; false is an authentication failure, not a
    // missing credential.
    async spendRecoveryCode(id: string, at: Date): Promise<boolean> {
      const rows = await tx
        .update(userCredentials)
        .set({
          secretData: sql`jsonb_set(${userCredentials.secretData}, '{usedAt}', to_jsonb(${at.toISOString()}::text))`,
          lastUsedAt: at,
        })
        .where(
          and(
            eq(userCredentials.id, id),
            eq(userCredentials.type, 'recovery-code'),
            sql`${userCredentials.secretData}->>'usedAt' IS NULL`,
          ),
        )
        .returning();
      return rows.length > 0;
    },

    // How many of a subject's codes are still worth something. Spent rows
    // are kept (ADR 0021) so a replay can be refused as spent, which makes
    // the row count useless for the one question that matters — whether the
    // subject can still recover — and a zero here is what owes them a fresh
    // set.
    async countUnspentRecoveryCodes(subjectId: string): Promise<number> {
      const rows = await tx
        .select({ id: userCredentials.id })
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.subjectId, subjectId),
            eq(userCredentials.type, 'recovery-code'),
            sql`${userCredentials.secretData}->>'usedAt' IS NULL`,
          ),
        );
      return rows.length;
    },

    // Regenerating a set of recovery codes replaces it: the old ten stop
    // working the moment the new ten are shown, spent or not. Named for the
    // one type it deletes rather than taking a CredentialType: nothing needs
    // to delete a subject's password or passkey in bulk, and a parameter
    // that would is one typo away from doing it. Returns how many rows went,
    // so a caller can tell a replacement from a first issue.
    async deleteRecoveryCodes(subjectId: string): Promise<number> {
      const rows = await tx
        .delete(userCredentials)
        .where(
          and(eq(userCredentials.subjectId, subjectId), eq(userCredentials.type, 'recovery-code')),
        )
        .returning({ id: userCredentials.id });
      return rows.length;
    },

    async deleteOne(id: string): Promise<void> {
      const rows = await tx.delete(userCredentials).where(eq(userCredentials.id, id)).returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('credential_not_found', `no credential with id ${id}`);
      }
    },

    // Password reset's write: replaces the existing password credential
    // rather than inserting a second one, which is what
    // user_credentials_one_password (0005; a partial unique index as of
    // 0034) would refuse anyway. RLS is what makes a foreign tenant's
    // subject match zero rows here, the same as every other write in this
    // package — that surfaces as credential_not_found rather than a silent
    // cross-tenant no-op.
    async setPassword(subjectId: string, hash: string): Promise<void> {
      const rows = await tx
        .update(userCredentials)
        // created_at dates the password, not the row — see rotatePassword.
        // A redeemed reset is a new password, so the tenant's maximum age
        // counts from here and not from the one it replaced.
        .set({
          secretData: serializeCredentialSecret({ kind: 'password', hash }),
          createdAt: sql`now()`,
        })
        .where(and(eq(userCredentials.subjectId, subjectId), eq(userCredentials.type, 'password')))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError(
          'credential_not_found',
          `no password credential for subject ${subjectId}`,
        );
      }
    },

    // The retired hashes a reuse check reads, newest first. Never a login's
    // input: passwordFor filters `type = 'password'`, so a row here cannot
    // authenticate anybody however many of them there are.
    async passwordHistory(subjectId: string): Promise<string[]> {
      const rows = await tx
        .select({ secretData: userCredentials.secretData })
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.subjectId, subjectId),
            eq(userCredentials.type, 'password-history'),
          ),
        )
        .orderBy(desc(userCredentials.createdAt), desc(userCredentials.id));
      return rows.map((row) => parseCredentialSecret('password-history', row.secretData).hash);
    },

    // Replaces the password in force and retires the one it displaces, so a
    // later change can be told from a reuse of it. A compare-and-swap on the
    // outgoing hash for the reason recordTotpUse is one: two rotations that
    // both read `from` serialize on the row, and the second matches nothing
    // rather than archiving a hash that is no longer in force. A false
    // return is that race, not a missing credential.
    async rotatePassword(
      subjectId: string,
      change: { from: string; to: string },
      historyDepth: number,
    ): Promise<boolean> {
      const rows = await tx
        .update(userCredentials)
        // created_at moves with the hash: one row holds a subject's password
        // for the life of the account (user_credentials_one_password, 0034),
        // so it dates the password in force rather than the row, and
        // passwordExpired reads it. Left alone, a rotation would leave the
        // new password already expired and the action owed forever.
        .set({
          secretData: serializeCredentialSecret({ kind: 'password', hash: change.to }),
          createdAt: sql`now()`,
        })
        .where(
          and(
            eq(userCredentials.subjectId, subjectId),
            eq(userCredentials.type, 'password'),
            sql`${userCredentials.secretData}->>'hash' = ${change.from}`,
          ),
        )
        .returning({ tenantId: userCredentials.tenantId });
      const row = rows[0];
      if (row === undefined) return false;

      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId: row.tenantId,
        subjectId,
        type: 'password-history',
        secretData: serializeCredentialSecret({ kind: 'password-history', hash: change.from }),
      });
      await trimPasswordHistory(tx, subjectId, historyDepth);
      return true;
    },
  };
}
