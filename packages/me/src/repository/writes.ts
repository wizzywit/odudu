import type {
  CredentialSummary,
  ProfileUpdate,
  UserRecord,
  VerificationUpdate,
} from '@odudu/domain-identity';
import type { MeAuditEvent } from '#/service/audit';

// What a change to the person's own account does inside one transaction, for
// the subject the token names and nobody else. Each method takes the subject it
// acts for and finds only that subject's rows; the tenant is the transaction's.
export interface MeWriteTx {
  // The profile row, locked until the transaction ends, or null.
  lockProfile(subjectId: string): Promise<UserRecord | null>;
  updateProfile(subjectId: string, patch: ProfileUpdate): Promise<UserRecord>;
  // Throws `UsernameTakenError` when another subject in the tenant holds the name.
  renameUser(subjectId: string, username: string): Promise<UserRecord>;
  setVerification(subjectId: string, patch: VerificationUpdate): Promise<UserRecord>;

  // Whether the subject owns the session, locking its row.
  lockOwnedSession(subjectId: string, sessionId: string): Promise<boolean>;
  // At most `limit` ids of the subject's sessions that have not ended, leaving
  // out `except` when it is named.
  liveSessionIds(
    subjectId: string,
    now: Date,
    limit: number,
    except: string | null,
  ): Promise<string[]>;
  // Ends the sessions the way a logout does: their grants are revoked and the
  // clients that registered a back-channel logout are told.
  endSessions(input: {
    readonly subjectId: string;
    readonly sessionIds: readonly string[];
    readonly now: Date;
    readonly issuer: string;
  }): Promise<void>;

  // Withdraws the subject's consent to the client with this OAuth `client_id`
  // and revokes every grant under it. Null where the subject gave none.
  revokeConsent(
    subjectId: string,
    clientKey: string,
    now: Date,
  ): Promise<{ readonly scopeNames: readonly string[]; readonly grantsRevoked: number } | null>;

  // Null where the subject holds no authenticator by that id.
  renameCredential(
    subjectId: string,
    credentialId: string,
    label: string,
  ): Promise<CredentialSummary | null>;

  audit(event: MeAuditEvent): Promise<void>;
}

// Every write of the "me" API runs in one transaction in the tenant it names,
// which commits when `run` returns and rolls back when it throws.
export interface MeWrites {
  transact<Result>(tenantId: string, run: (tx: MeWriteTx) => Promise<Result>): Promise<Result>;
}
