import { describe, expect, it } from 'vitest';
import { FRESH_CREATION, administratorOf } from '#/entities/creation-draft';
import {
  administratorTitle,
  firstAdministratorNote,
  originText,
  titleOrigin,
} from '#/pages/tenants/services/administratorOrigin';

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

describe('the administrator step copy', () => {
  it('says where the tenant came from, after its name', () => {
    expect(originText('created')).toBe(
      'was created. It has no administrator yet, so nobody can sign in to its console.',
    );
    expect(originText('imported')).toBe(
      'was imported. An import creates no administrator, so nobody can sign in to its console yet.',
    );
    expect(originText('existing')).toBe('gets another administrator.');
  });

  it('says a first administrator holds Full, and nothing for a further one', () => {
    expect(firstAdministratorNote('created', 'acme')).toBe(
      'The first administrator holds Full, so somebody in acme can give every capability; narrow it afterwards under Administrators.',
    );
    expect(firstAdministratorNote('imported', 'acme')).not.toBeNull();
    expect(firstAdministratorNote('existing', 'acme')).toBeNull();
  });
});
