/** A console session unseen for this long has ended. */
export const CONSOLE_SESSION_IDLE_SECONDS = 30 * 60;

/** A console session ends this long after sign-in, however active. */
export const CONSOLE_SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;

/**
 * A sign-in not completed within this long has to start again: as long as
 * the provider's own default login_ttl_seconds, which the person spends it on.
 */
export const CONSOLE_LOGIN_SECONDS = 30 * 60;

/** `last_seen_at` is written at most this often, so a busy tab is not a write per call. */
export const CONSOLE_SESSION_TOUCH_SECONDS = 60;

interface SessionTimes {
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

export function sessionHasEnded(session: SessionTimes, now: Date): boolean {
  const idleMs = now.getTime() - session.lastSeenAt.getTime();
  return idleMs > CONSOLE_SESSION_IDLE_SECONDS * 1000 || now >= session.expiresAt;
}

export function sessionNeedsTouch(session: SessionTimes, now: Date): boolean {
  return now.getTime() - session.lastSeenAt.getTime() >= CONSOLE_SESSION_TOUCH_SECONDS * 1000;
}

/** An access token this close to its expiry is refreshed before it is used. */
export const ACCESS_REFRESH_WINDOW_SECONDS = 30;

export function accessNeedsRefresh(
  session: { readonly accessExpiresAt: Date },
  now: Date,
): boolean {
  return session.accessExpiresAt.getTime() - now.getTime() <= ACCESS_REFRESH_WINDOW_SECONDS * 1000;
}
