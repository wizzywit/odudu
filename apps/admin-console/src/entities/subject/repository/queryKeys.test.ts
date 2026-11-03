import { expect, it } from 'vitest';
import { adminRolesKey, subjectReadKey } from '#/entities/subject/repository/queryKeys';

it('names the admin roles of a tenant and each read of a subject by its kind', () => {
  expect(adminRolesKey('acme')).toEqual(['admin-roles', 'acme']);
  expect(subjectReadKey('lockout', 'acme', 's1')).toEqual(['lockout', 'acme', 's1']);
  expect(subjectReadKey('credentials', 'acme', 's1')).toEqual(['credentials', 'acme', 's1']);
});

it('is a prefix of what it names when given no more than the tenant', () => {
  expect(subjectReadKey('lockout', 'acme')).toEqual(['lockout', 'acme']);
});
