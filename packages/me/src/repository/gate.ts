import type { MeSessionLifespans } from '#/service/session-view';

// What the freshness gate reads: one session, by its id, for the subject a
// token names, in the tenant it names.
export interface MeSessionAuth {
  // When the sign-in behind the session happened (its `auth_time`), or null
  // when the subject holds no session by that id that is still live.
  signedInAt(
    tenantId: string,
    subjectId: string,
    sessionId: string,
    lifespans: MeSessionLifespans,
    now: Date,
  ): Promise<Date | null>;
}
