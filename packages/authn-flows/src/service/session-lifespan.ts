export interface SessionLifespans {
  readonly ssoSessionIdleSeconds: number;
  readonly ssoSessionMaxSeconds: number;
  readonly rememberMeIdleSeconds: number;
  readonly rememberMeMaxSeconds: number;
}

// Which pair a session is measured against. One function so that the
// idle window a request checks and the ceiling its row was created with
// can never come from different pairs.
export function lifespanFor(
  tenant: SessionLifespans,
  remembered: boolean,
): { idleSeconds: number; maxSeconds: number } {
  return remembered
    ? { idleSeconds: tenant.rememberMeIdleSeconds, maxSeconds: tenant.rememberMeMaxSeconds }
    : { idleSeconds: tenant.ssoSessionIdleSeconds, maxSeconds: tenant.ssoSessionMaxSeconds };
}
