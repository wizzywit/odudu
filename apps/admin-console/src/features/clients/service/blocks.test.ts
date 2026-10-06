import { expect, it } from 'vitest';
import {
  deleteFixed,
  enabledFixed,
  listsReadOnly,
  redirectsFixed,
} from '#/features/clients/service/blocks.ts';

const ADMIN = { builtin_admin: true, client_id: 'odudu-admin' };
const OTHER = { builtin_admin: false, client_id: 'billing' };

it('fixes what could lock every administrator out, on the built-in admin client alone', () => {
  expect(enabledFixed(ADMIN)).toMatch(/^odudu-admin cannot be disabled\. This is the tenant's/u);
  expect(redirectsFixed(ADMIN)).toMatch(/^odudu-admin's redirect URIs and web origins cannot/u);
  expect(deleteFixed(ADMIN)).toMatch(/^odudu-admin cannot be deleted\./u);
  expect([enabledFixed(OTHER), redirectsFixed(OTHER), deleteFixed(OTHER)]).toEqual([
    null,
    null,
    null,
  ]);
});

it('shows the two lists as text where the page is read-only, or where they are fixed', () => {
  expect(listsReadOnly(OTHER, true)).toBe(false);
  expect(listsReadOnly(OTHER, false)).toBe(true);
  expect(listsReadOnly(ADMIN, true)).toBe(true);
});
