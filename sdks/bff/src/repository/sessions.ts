import { lockKey, loginKey, sessionKey } from '#/services/session-id';
import { LOGIN_TTL_MS, REFRESH_LOCK_TTL_MS } from '#/services/session-policy';
import type { LoginInProgress, SessionStore, SignedInSession } from '#/types';

export interface Sessions {
  loadSession(id: string): Promise<SignedInSession | undefined>;
  saveSession(id: string, session: SignedInSession): Promise<void>;
  dropSession(id: string): Promise<void>;
  // The release function of the lock on a session's refresh, a no-op for a
  // store with no locks, and undefined when the store did not grant the lock.
  lockSession(id: string): Promise<(() => Promise<void>) | undefined>;
  saveLogin(id: string, login: LoginInProgress): Promise<void>;
  // Reads a login record and removes it, so it can be used once.
  takeLogin(id: string): Promise<LoginInProgress | undefined>;
}

export interface Stores {
  sessions: SessionStore;
  logins: SessionStore;
}

const NO_LOCK = (): Promise<void> => Promise.resolve();

export function createSessions(
  stores: Stores,
  sessionTtlMs: (createdAt: number) => number,
): Sessions {
  return {
    async loadSession(id) {
      const record = await stores.sessions.get(sessionKey(id));
      return record?.kind === 'session' ? record : undefined;
    },
    saveSession: (id, session) =>
      stores.sessions.set(sessionKey(id), session, sessionTtlMs(session.createdAt)),
    dropSession: (id) => stores.sessions.delete(sessionKey(id)),
    async lockSession(id) {
      if (stores.sessions.lock === undefined) return NO_LOCK;
      const release = await stores.sessions.lock(lockKey(id), REFRESH_LOCK_TTL_MS);
      // A lock that cannot be released lapses with its TTL.
      return release === undefined ? undefined : () => release().catch(() => undefined);
    },
    saveLogin: (id, login) => stores.logins.set(loginKey(id), login, LOGIN_TTL_MS),
    // Get then delete, not atomic: two callbacks racing on one record both read
    // it, but the issuer accepts an authorization code once, so the second
    // exchange fails.
    async takeLogin(id) {
      const record = await stores.logins.get(loginKey(id));
      await stores.logins.delete(loginKey(id));
      return record?.kind === 'login' ? record : undefined;
    },
  };
}
