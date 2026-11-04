import { pathAddress } from '@odudu/kernel';
import { type DatabaseHandle } from '@odudu/db';
import { describe, expect, it } from 'vitest';
import { findHeldSignInIn } from '#/held-sign-in';

// A database that fails the test the moment anything asks it for a connection.
const UNREACHABLE = {
  db: {
    transaction: () => {
      throw new Error('the database was asked');
    },
  },
} as unknown as DatabaseHandle;

describe('findHeldSignInIn', () => {
  const find = findHeldSignInIn(UNREACHABLE, false);
  const tenant = { id: '0192f2a0-0000-7000-8000-000000000001', name: 'acme' };

  it.each([
    ['no Cookie header', undefined],
    ['a Cookie header without the handle', 'theme=dark; acme-session=x'],
    ['a handle that is not a session and a secret', 'odudu-sign-in=garbage'],
    [
      'a handle of the other TLS mode',
      '__Secure-odudu-sign-in=0192f2a0-0000-7000-8000-000000000002.abc',
    ],
  ])('asks the database nothing for %s', async (_label, header) => {
    expect(await find(tenant, header, pathAddress('https://idp.example', tenant.name))).toBeNull();
  });
});
