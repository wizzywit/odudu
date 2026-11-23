import { defaultStore } from '#/adapter/default-store';
import { storeKey } from '#/services/split-store';
import type { HandlersConfig } from '#/services/config';
import type { OduduHandlersOptions } from '#/types';
import type { SessionStore } from '@odudu-io/bff';

// The store the app named, or the process's default one for this BFF.
export function storeOf(options: OduduHandlersOptions, config: HandlersConfig): SessionStore {
  return (
    options.store ??
    defaultStore(
      storeKey({
        issuer: options.issuer,
        clientId: options.clientId,
        cookieName: config.cookieName,
      }),
      options.deps?.now ?? Date.now,
    )
  );
}
