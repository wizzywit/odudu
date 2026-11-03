import { expect, it } from 'vitest';
import { administratorOf, FRESH_CREATION } from '#/features/tenants/services/creationDraft';
import { administratorTitle, titleOrigin } from '#/features/tenants/services/administratorOrigin';

it('titles the page by where the tenant came from, an existing one when nothing is stored', () => {
  expect(titleOrigin(null)).toBe('existing');
  expect(titleOrigin(FRESH_CREATION)).toBe('existing');
  expect(titleOrigin(administratorOf('acme', 'created'))).toBe('created');
  expect(titleOrigin(administratorOf('acme', 'imported'))).toBe('imported');
});

it('titles a first administrator apart from another one', () => {
  expect(administratorTitle('acme', 'created')).toBe('First administrator of acme');
  expect(administratorTitle('acme', 'imported')).toBe('First administrator of acme');
  expect(administratorTitle('acme', 'existing')).toBe('Add an administrator to acme');
});
