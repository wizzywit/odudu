import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why.
export const authenticationSessions = pgTable('authentication_sessions', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  pendingRequest: jsonb('pending_request').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Set exactly once, by the atomic conditional UPDATE in
  // authenticationSessionRepository().consume() — never read-then-written —
  // so a session that has already driven one successful login cannot drive
  // a second, even from two requests racing on the same id.
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  // Authenticator names this authentication has already satisfied — what
  // lets a multi-step login resume rather than restart (a correct password
  // followed by a wrong second factor must not ask for the password again).
  satisfied: text('satisfied').array().notNull().default([]),
  // Whose attempt this is, written the moment a factor identifies someone
  // (packages/db/drizzle/0038_authentication_sessions_subject.sql). Every
  // later factor is then looked up for this subject and has to answer with
  // it, so a second factor cannot hand the login to anybody else.
  subjectId: uuid('subject_id'),
  // When the flow had nothing left to ask the bound subject; null while any
  // step remains. `subjectId` is written by the *first* factor, so it says
  // whose attempt this is and not that the attempt finished — and a
  // required action, which carries no credentials of its own, may only be
  // satisfied by a login that did (migration
  // packages/db/drizzle/0044_authentication_sessions_authenticated.sql).
  authenticatedAt: timestamp('authenticated_at', { withTimezone: true }),
  // The challenge a WebAuthn ceremony in progress must be answered with.
  // Server-side because a challenge the response carries proves nothing;
  // single-column because one attempt runs one ceremony at a time. Read and
  // cleared by one statement (claimWebauthnChallenge), which is what makes a
  // replayed response find nothing rather than the same challenge twice.
  webauthnChallenge: text('webauthn_challenge'),
}).enableRLS();

// The bytes validated at /authorize are the bytes bound to the code later
// issued: parking the whole request (rather than re-deriving it from form
// fields) is what stops scope or redirect_uri being edited in between.
export interface PendingRequest {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string | null;
  nonce: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  // The subject named by a validated `id_token_hint` (OIDC Core §3.1.2.1).
  // Absent when the request carried no hint; when present, whoever signs in
  // has to be that subject for the request to be answered positively.
  idTokenHintSubject?: string;
  // The request's own `prompt` values (OIDC Core §3.1.2.1), parked
  // alongside everything else so a consent decision made after the detour
  // — a required action, a fresh login, a promoted session reuse — still
  // sees `prompt=consent` the way it would have at the moment the request
  // first arrived. Absent is the same as empty: no value was sent.
  prompt?: string[];
  // Present only when this session was started to promote a session reuse
  // into a consent decision (protocol-oidc's authorization-request.ts):
  // the SSO session to complete into, and the instant it actually
  // authenticated. completeAuthorizedLogin reuses that session and reports
  // that `auth_time` rather than establishing a fresh one — asking for
  // consent must not itself count as a new authentication. `reuseAuthTime`
  // is an ISO string, jsonb's only way to carry a Date.
  reuseSessionId?: string;
  reuseAuthTime?: string;
  // The already realm-gated `remember_me` decision, parked here only when
  // a detour — today, consent — completes the login from a door that
  // never asks the field itself (login-submission.ts's `recordRememberMe`,
  // its only writer). Absent, the same as `false`, on every session this
  // was never written against.
  rememberMe?: boolean;
}

export interface AuthenticationSessionRecord {
  id: string;
  realmId: string;
  pendingRequest: PendingRequest;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  satisfied: string[];
  subjectId: string | null;
  authenticatedAt: Date | null;
  webauthnChallenge: string | null;
}
