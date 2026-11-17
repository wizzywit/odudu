import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, eq, gt, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { pendingRegistrations } from '#/schema/pending-registrations';

// The mailed key says what it opens, so the link route reads the right table
// without a lookup in the wrong one first.
const KEY_PREFIX = 'reg_';

export function isRegistrationKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX);
}

function sha256Hex(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface PendingRegistrationInput {
  readonly tenantId: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly authenticationSessionId?: string | null | undefined;
  readonly ttlSeconds: number;
  readonly now: Date;
}

export interface WaitingRegistration {
  readonly username: string;
  readonly email: string;
}

export interface PendingRegistration {
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly authenticationSessionId: string | null;
}

export function pendingRegistrationRepository(tx: TenantScopedDatabase) {
  return {
    // One row per address, case-insensitively: a repeat replaces the earlier
    // request, whose link stops working, so a tenant holds at most one row
    // for any address however often it is asked.
    async replace(input: PendingRegistrationInput): Promise<{ key: string }> {
      const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
      const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
      await tx
        .insert(pendingRegistrations)
        .values({
          id: newId(),
          tenantId: input.tenantId,
          tokenHash: sha256Hex(key),
          username: input.username,
          email: input.email,
          passwordHash: input.passwordHash,
          authenticationSessionId: input.authenticationSessionId ?? null,
          createdAt: input.now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [pendingRegistrations.tenantId, pendingRegistrations.emailSearch],
          set: {
            tokenHash: sql`excluded.token_hash`,
            username: sql`excluded.username`,
            email: sql`excluded.email`,
            passwordHash: sql`excluded.password_hash`,
            authenticationSessionId: sql`excluded.authentication_session_id`,
            createdAt: sql`excluded.created_at`,
            expiresAt: sql`excluded.expires_at`,
          },
        });
      return { key };
    },

    // A read for the page a link opens: who is waiting under this key, if
    // anybody. Changes nothing, so a mail scanner's visit leaves it be.
    async waiting(key: string, now: Date): Promise<WaitingRegistration | null> {
      const rows = await tx
        .select({ username: pendingRegistrations.username, email: pendingRegistrations.email })
        .from(pendingRegistrations)
        .where(
          and(
            eq(pendingRegistrations.tokenHash, sha256Hex(key)),
            gt(pendingRegistrations.expiresAt, now),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    // One statement, so two clicks on a link cannot both create the account.
    async take(key: string, now: Date): Promise<PendingRegistration | null> {
      const rows = await tx
        .delete(pendingRegistrations)
        .where(
          and(
            eq(pendingRegistrations.tokenHash, sha256Hex(key)),
            gt(pendingRegistrations.expiresAt, now),
          ),
        )
        .returning();
      const row = rows[0];
      return row === undefined
        ? null
        : {
            username: row.username,
            email: row.email,
            passwordHash: row.passwordHash,
            authenticationSessionId: row.authenticationSessionId,
          };
    },
  };
}
