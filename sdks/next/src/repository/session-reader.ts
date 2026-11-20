import { cookieOfRender } from '#/adapter/next-cookies';
import { sessionFromStore } from '#/services/claims';
import type { Session } from '#/types';
import type { SessionStore } from '@odudu-io/bff';

export interface SessionReader {
  // The signed-in person for the request being rendered. Reads the store and
  // never writes it.
  read(): Promise<Session | null>;
}

export function createSessionReader(
  store: SessionStore,
  cookieName: string,
  now: () => number,
): SessionReader {
  return {
    read: async () =>
      sessionFromStore(await cookieOfRender(cookieName), (key) => store.get(key), now()),
  };
}
