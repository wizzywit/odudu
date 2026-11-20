import { loginKey, sessionKey } from '#/services/session-id';
import { LOGIN_TTL_MS } from '#/services/session-policy';
import type { LoginInProgress, SessionStore, SignedInSession } from '#/types';

export interface Sessions {
  loadSession(id: string): Promise<SignedInSession | undefined>;
  saveSession(id: string, session: SignedInSession): Promise<void>;
  dropSession(id: string): Promise<void>;
  saveLogin(id: string, login: LoginInProgress): Promise<void>;
  // Reads a login record and removes it, so it can be used once.
  takeLogin(id: string): Promise<LoginInProgress | undefined>;
}

export interface Stores {
  sessions: SessionStore;
  logins: SessionStore;
}

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
    saveLogin: (id, login) => stores.logins.set(loginKey(id), login, LOGIN_TTL_MS),
    async takeLogin(id) {
      const record = await stores.logins.get(loginKey(id));
      await stores.logins.delete(loginKey(id));
      return record?.kind === 'login' ? record : undefined;
    },
  };
}
