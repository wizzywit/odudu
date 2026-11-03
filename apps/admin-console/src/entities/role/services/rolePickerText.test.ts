import { expect, it } from 'vitest';
import {
  roleAccessibleName,
  roleDetail,
  roleOption,
  roleOwnerTag,
} from '#/entities/role/services/rolePickerText';
import { roleOwnerShort } from '#/shared/services/capabilities';

const TENANT = { name: 'auditor', client_id: null, client_key: null, description: null };
const CLIENT = { name: 'admin', client_id: 'c-1', client_key: 'portal', description: null };
const KEYLESS = { name: 'admin', client_id: 'c-1', client_key: null, description: null };

it('words the owner as the capabilities owner does, with the description after it', () => {
  expect(roleDetail(TENANT)).toBe(roleOwnerShort(null));
  expect(roleDetail(CLIENT)).toBe(roleOwnerShort('portal'));
  expect(roleDetail({ ...CLIENT, description: '' })).toBe(roleOwnerShort('portal'));
  expect(roleDetail({ ...TENANT, description: 'Reads the books' })).toBe(
    `${roleOwnerShort(null)} · Reads the books`,
  );
});

it('names a client by its id when its key is not known', () => {
  expect(roleDetail(KEYLESS)).toBe('client c-1');
  expect(roleAccessibleName(KEYLESS)).toBe('admin, a role of client c-1');
});

it('speaks the owner in the accessible name', () => {
  expect(roleAccessibleName(TENANT)).toBe('auditor, a tenant role');
  expect(roleAccessibleName(CLIENT)).toBe('admin, a role of client portal');
});

it('tags a role as the capabilities owner does', () => {
  expect(roleOwnerTag(TENANT)).toBe('tenant role');
  expect(roleOwnerTag(CLIENT)).toBe('role of client portal');
  expect(roleOwnerTag({ client_id: 'c-admin', client_key: 'odudu-admin' })).toBe(
    'admin capability',
  );
});

it('gives a role the detail and the accessible name it is picked by', () => {
  expect(roleOption(CLIENT)).toEqual({
    detail: roleDetail(CLIENT),
    accessibleName: roleAccessibleName(CLIENT),
  });
});
