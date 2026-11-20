import { createMemoryStore } from '@odudu-io/bff';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOduduHandlers } from '#/index';

const WARNED = Symbol.for('@odudu-io/next/default-store-warned');
const options = {
  issuer: 'https://id.example/tenants/demo',
  clientId: 'web1',
  redirectUri: 'https://app.example/api/auth/callback',
  scope: 'openid',
};

let emitted: { message: string; code: string | undefined }[];
beforeEach(() => {
  emitted = [];
  Reflect.deleteProperty(globalThis, WARNED);
  vi.spyOn(process, 'emitWarning').mockImplementation(((warning: string, init?: unknown) => {
    const code =
      typeof init === 'object' && init !== null && 'code' in init ? init.code : undefined;
    emitted.push({ message: warning, code: typeof code === 'string' ? code : undefined });
  }) as typeof process.emitWarning);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the default store in production', () => {
  it('warns once per process, with a code, however many handlers use it', () => {
    vi.stubEnv('NODE_ENV', 'production');
    createOduduHandlers(options);
    createOduduHandlers({ ...options, clientId: 'web2' });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.code).toBe('ODUDU_NEXT_DEFAULT_STORE');
    expect(emitted[0]?.message).toContain('store');
  });

  it.each(['development', 'test'])('says nothing in %s', (env) => {
    vi.stubEnv('NODE_ENV', env);
    createOduduHandlers(options);
    expect(emitted).toEqual([]);
  });

  it('says nothing when the app brought its own store', () => {
    vi.stubEnv('NODE_ENV', 'production');
    createOduduHandlers({ ...options, store: createMemoryStore() });
    expect(emitted).toEqual([]);
  });
});
