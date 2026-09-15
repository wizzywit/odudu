import { type SessionRecord } from '#/schema/sessions';

// Both boundaries are exclusive: a session whose ceiling is exactly now, or
// whose idle window closes exactly now, is dead. Read-time enforcement is
// what makes an expired row unredeemable regardless of whether anything has
// reaped it (ADR 0021).
export function isSessionLive(
  session: Pick<SessionRecord, 'expiresAt' | 'lastActiveAt'>,
  idleSeconds: number,
  now: Date,
): boolean {
  if (now.getTime() >= session.expiresAt.getTime()) return false;
  return now.getTime() - session.lastActiveAt.getTime() < idleSeconds * 1000;
}
