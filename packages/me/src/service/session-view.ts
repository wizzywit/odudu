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
  readonly deviceId: string | null;
}

export interface SessionView {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly expiresAt: Date;
  readonly remembered: boolean;
  // Whether this is the session the token was issued for.
  readonly current: boolean;
  // An opaque id shared by every session opened on one browser; null for a
  // session opened before it was recorded.
  readonly device: string | null;
}

export function isTokenSession(sessionId: string, tokenSessionId: string | null): boolean {
  return tokenSessionId !== null && sessionId === tokenSessionId;
}

export function sessionView(record: MeSessionRecord, tokenSessionId: string | null): SessionView {
  return {
    id: record.id,
    createdAt: record.createdAt,
    lastActiveAt: record.lastActiveAt,
    expiresAt: record.expiresAt,
    remembered: record.remembered,
    current: isTokenSession(record.id, tokenSessionId),
    device: record.deviceId,
  };
}
