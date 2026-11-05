import { DEFAULT_LIMIT } from '@odudu/contracts/admin';
import { MAX_DOMAINS_PER_TENANT } from '@odudu/domain-tenant';
import { expect, it } from 'vitest';

// The console reads one page of a tenant's domains and has no next page to
// follow, which holds only while every domain fits the default page.
it('keeps the per-tenant domain cap below the default page size', () => {
  expect(MAX_DOMAINS_PER_TENANT).toBeLessThan(DEFAULT_LIMIT);
});
