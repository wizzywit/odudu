// The tenant's session lifespans, which decide whether a session is still live.
export interface MeSessionLifespans {
  readonly ssoSessionIdleSeconds: number;
  readonly ssoSessionMaxSeconds: number;
  readonly rememberMeIdleSeconds: number;
  readonly rememberMeMaxSeconds: number;
}

export interface MeSessionRecord {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly expiresAt: Date;
  readonly remembered: boolean;
}

export interface SessionView {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly expiresAt: Date;
  readonly remembered: boolean;
  // Whether this is the session the token was issued for.
  readonly current: boolean;
  // Null until a session records the device it was opened on.
  readonly device: null;
}

export function sessionView(record: MeSessionRecord, tokenSessionId: string | null): SessionView {
  return {
    id: record.id,
    createdAt: record.createdAt,
    lastActiveAt: record.lastActiveAt,
    expiresAt: record.expiresAt,
    remembered: record.remembered,
    current: tokenSessionId !== null && record.id === tokenSessionId,
    device: null,
  };
}
