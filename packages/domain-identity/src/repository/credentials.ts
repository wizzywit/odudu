import { type RealmScopedDatabase } from '@odudu/db';
import { newId, OduduError } from '@odudu/kernel';
import { and, eq, sql } from 'drizzle-orm';
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
  realmId: string;
  subjectId: string;
  type: CredentialType;
  secret: CredentialSecret;
  label?: string;
  lookupKey?: string;
}

function toRecord(row: typeof userCredentials.$inferSelect): CredentialRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    subjectId: row.subjectId,
    type: row.type,
    secret: parseCredentialSecret(row.type, row.secretData),
    label: row.label,
    lastUsedAt: row.lastUsedAt,
    lookupKey: row.lookupKey,
    createdAt: row.createdAt,
  };
}

export function credentialRepository(tx: RealmScopedDatabase) {
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
        realmId: input.realmId,
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
    // 0034) would refuse anyway. RLS is what makes a foreign realm's
    // subject match zero rows here, the same as every other write in this
    // package — that surfaces as credential_not_found rather than a silent
    // cross-realm no-op.
    async setPassword(subjectId: string, hash: string): Promise<void> {
      const rows = await tx
        .update(userCredentials)
        .set({ secretData: serializeCredentialSecret({ kind: 'password', hash }) })
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
  };
}
