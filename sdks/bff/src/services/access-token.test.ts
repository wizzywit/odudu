import { describe, expect, it } from 'vitest';
import { accessTokenFor } from '#/services/access-token';
import type { TokenSet } from '@odudu-io/oidc';
import type { Upstream } from '#/types';

const tokens = {
  issuer: 'https://id.example/t',
  byAudience: {
    'https://id.example/t': { accessToken: 'own', expiresAt: 2000, scope: '' },
    'https://api.example/': { accessToken: 'api', expiresAt: 500, scope: '' },
  },
} as unknown as TokenSet;
const upstream = (resource?: string): Upstream => ({
  name: 'a',
  origin: 'https://a.example',
  pathPrefixes: ['/'],
  ...(resource === undefined ? {} : { resource }),
});

describe('accessTokenFor', () => {
  it('uses the issuer audience unless the upstream names one', () => {
    expect(accessTokenFor(tokens, upstream())).toEqual({ kind: 'token', value: 'own' });
  });

  it('reports an audience the sign-in did not carry', () => {
    expect(accessTokenFor(tokens, upstream('https://x/'))).toEqual({ kind: 'not-granted' });
  });
});
