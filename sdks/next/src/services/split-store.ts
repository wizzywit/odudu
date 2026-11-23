import type { SessionStore } from '@odudu-io/bff';

// Two stores behind one: a record of a sign-in that is still under way goes to
// `logins`, a signed-in browser's to `sessions`, so a flood of `login`
// requests can never push a session out of a bounded store.
export function splitStore(sessions: SessionStore, logins: SessionStore): SessionStore {
  return {
    get: async (id) => (await sessions.get(id)) ?? logins.get(id),
    set: (id, session, ttlMs) =>
      (session.kind === 'login' ? logins : sessions).set(id, session, ttlMs),
    delete: async (id) => {
      await Promise.all([sessions.delete(id), logins.delete(id)]);
    },
  };
}

export interface StoreIdentity {
  issuer: string;
  clientId: string;
  cookieName: string;
}

// What makes two handlers one BFF: the same issuer, client and cookie.
export function storeKey(identity: StoreIdentity): string {
  return JSON.stringify([identity.issuer, identity.clientId, identity.cookieName]);
}
