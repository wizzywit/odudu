import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@site/src/features/landing/services/capabilityCards';

describe('the capability cards', () => {
  it('lists the capabilities by title', () => {
    expect(CAPABILITIES.map((card) => card.title)).toEqual([
      'Standard sign-in',
      'Many tenants',
      'Passwords and second factors',
      'Sessions that end properly',
      'Services and delegation',
      'An admin API and console',
      'An audit trail',
      'One container and Postgres',
    ]);
  });
});
