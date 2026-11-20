import { readJson } from '#/adapter/responses';
import { cookieHeaderOfRender } from '#/adapter/next-cookies';
import { sessionRequest } from '#/adapter/requests';
import type { Bff } from '@odudu-io/bff';

export interface SessionReader {
  // The BFF's answer to the `session` route for the request being rendered,
  // as parsed JSON, or undefined when it is not JSON.
  read(): Promise<unknown>;
}

export function createSessionReader(bff: Bff): SessionReader {
  return {
    read: async () => readJson(await bff.session(sessionRequest(await cookieHeaderOfRender()))),
  };
}
