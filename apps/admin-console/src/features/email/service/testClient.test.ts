import { describe, expect, it } from 'vitest';
import {
  chosenTestClient,
  DEFAULT_TEST_CLIENT,
  testClientId,
  testClientsClosed,
  testClientsRead,
  testClientSelection,
  testClientSummary,
} from '#/features/email/service/testClient';

const OWN = { id: 'c-admin', name: 'Odudu admin', client_id: 'odudu-admin' };
const OTHER = { id: 'c-bill', name: 'Billing', client_id: 'billing' };

describe('testClientId', () => {
  it('starts on the client the administrator signed in with, when the list holds it', () => {
    expect(testClientId(DEFAULT_TEST_CLIENT, 'ready', [OTHER, OWN])).toBe('c-admin');
  });

  it.each([
    ['the list does not hold it', 'ready', [OTHER]],
    ['the list is not loaded yet', 'loading', [OWN]],
    ['the list failed', 'failed', []],
    ['the list is refused', 'refused', []],
  ] as const)('starts on the tenant’s own look when %s', (_why, status, options) => {
    expect(testClientId(DEFAULT_TEST_CLIENT, status, options)).toBeNull();
  });

  it('keeps what was chosen, over the default', () => {
    expect(testClientId({ kind: 'tenant' }, 'ready', [OWN])).toBeNull();
    expect(testClientId({ kind: 'client', id: 'c-bill' }, 'ready', [OWN, OTHER])).toBe('c-bill');
  });
});

describe('chosenTestClient', () => {
  it('reads the picker’s ids as a client, or as the tenant’s own when it holds none', () => {
    expect(chosenTestClient(['c-bill'])).toEqual({ kind: 'client', id: 'c-bill' });
    expect(chosenTestClient(['c-admin', 'c-bill'])).toEqual({ kind: 'client', id: 'c-bill' });
    expect(chosenTestClient([])).toEqual({ kind: 'tenant' });
  });
});

describe('testClientSelection', () => {
  it('selects the client sent as, and nothing for the tenant’s own', () => {
    expect(testClientSelection('c-bill')).toEqual(['c-bill']);
    expect(testClientSelection(null)).toEqual([]);
  });
});

describe('testClientSummary', () => {
  it('says whose look the message will wear', () => {
    expect(testClientSummary(null, [OWN])).toMatch(/tenant’s own look/u);
    expect(testClientSummary('c-admin', [OWN, OTHER])).toBe(
      'Sent as Odudu admin, the client you signed in with.',
    );
    expect(testClientSummary('c-bill', [OWN, OTHER])).toBe('Sent as Billing.');
  });
});

describe('the client choice follows whoami', () => {
  const holder = { capabilities: ['manage-tenant', 'manage-clients'] as const, crossTenant: false };
  const other = { capabilities: ['manage-tenant'] as const, crossTenant: false };

  it('reads the list only for an operator who may', () => {
    expect(testClientsRead(holder)).toBe(true);
    expect(testClientsRead(other)).toBe(false);
    expect(testClientsRead(undefined)).toBe(false);
  });

  it('closes the choice only once whoami says the capability is missing', () => {
    expect(testClientsClosed(other)).toBe(true);
    expect(testClientsClosed(holder)).toBe(false);
    expect(testClientsClosed(undefined)).toBe(false);
  });
});
