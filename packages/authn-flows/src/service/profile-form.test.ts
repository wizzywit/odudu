import { type UserRecord } from '@odudu/domain-identity';
import { describe, expect, it } from 'vitest';
import {
  editableProfileFields,
  invalidProfileFields,
  prefilledValues,
  submittedValues,
  unfilledFields,
} from '#/service/profile-form';

const PERSON = {
  username: 'ada',
  name: 'Ada Lovelace',
  givenName: 'Ada',
  familyName: null,
  nickname: '',
  birthdate: '1815-12-10',
} as unknown as UserRecord;

describe('editableProfileFields', () => {
  it('are the claims a person edits through PATCH /me/profile, in form order', () => {
    const fields = editableProfileFields(false);
    expect(fields).toHaveLength(20);
    expect(fields.slice(0, 3)).toEqual(['name', 'given_name', 'family_name']);
    expect(fields.at(-1)).toBe('address_country');
    expect(fields).not.toContain('username');
    expect(fields).not.toContain('email');
  });

  it('leads with the username where the tenant lets one change', () => {
    expect(editableProfileFields(true)[0]).toBe('username');
    expect(editableProfileFields(true)).toHaveLength(21);
  });
});

describe('prefilledValues', () => {
  it('shows what the person holds, and nothing for an empty claim', () => {
    const values = prefilledValues(PERSON, editableProfileFields(true));
    expect(values.username).toBe('ada');
    expect(values.name).toBe('Ada Lovelace');
    expect(values.family_name).toBe('');
    expect(values.nickname).toBe('');
  });
});

describe('submittedValues', () => {
  it('reads only the editable fields, trimmed, an empty one as no value', () => {
    const fields = editableProfileFields(false);
    expect(
      submittedValues(
        { name: '  Ada  ', nickname: '   ', email: 'x@example.com', password: 'p', unknown: 'y' },
        fields,
      ),
    ).toEqual({ name: 'Ada', nickname: null });
  });

  it('ignores a username that is empty, and one the tenant does not let change', () => {
    expect(submittedValues({ username: '' }, editableProfileFields(true))).toEqual({});
    expect(submittedValues({ username: 'grace' }, editableProfileFields(false))).toEqual({});
    expect(submittedValues({ username: ' grace ' }, editableProfileFields(true))).toEqual({
      username: 'grace',
    });
  });
});

describe('unfilledFields', () => {
  const required = ['name', 'family_name', 'nickname'];

  it('names a required field that is empty before and after the form', () => {
    expect(unfilledFields(PERSON, { name: 'Ada' }, required)).toEqual(['family_name', 'nickname']);
  });

  it('counts a field the form filled', () => {
    expect(unfilledFields(PERSON, { family_name: 'King', nickname: 'ada' }, required)).toEqual([]);
  });

  it('names a required field the form emptied, though it had a value', () => {
    expect(
      unfilledFields(PERSON, { name: null, family_name: 'K', nickname: 'a' }, required),
    ).toEqual(['name']);
  });

  it('asks nothing of a field that is not required, and nothing at all of an empty list', () => {
    expect(unfilledFields(PERSON, {}, ['name'])).toEqual([]);
    expect(unfilledFields(PERSON, {}, [])).toEqual([]);
  });
});

describe('invalidProfileFields', () => {
  it('names every value the me API would refuse, not only the first', () => {
    expect(
      invalidProfileFields(PERSON, {
        birthdate: 'yesterday',
        website: 'ftp://example.com',
        name: 'Ada',
        zoneinfo: '+1',
      }),
    ).toEqual([
      { field: 'birthdate', reason: 'shape' },
      { field: 'website', reason: 'shape' },
      { field: 'zoneinfo', reason: 'shape' },
    ]);
  });

  it('refuses nothing for a form of good values, or of empty ones', () => {
    expect(invalidProfileFields(PERSON, { birthdate: '1815-12-10', nickname: null })).toEqual([]);
  });
});
