import { describe, expect, it } from 'vitest';
import { amendableSubjectFields, refusalFor, SUBJECT_FIELDS } from '#/service/subjects-patch';

const LOCKED = { usernameEditable: false };
const EDITABLE = { usernameEditable: true };

describe('the subject amendment allowlist', () => {
  it('admits email and enabled, and nothing else, while usernames are not editable', () => {
    expect(amendableSubjectFields(LOCKED)).toEqual(['email', 'enabled']);
  });

  it('admits username too once the tenant enables username_editable', () => {
    expect(amendableSubjectFields(EDITABLE)).toEqual(['username', 'email', 'enabled']);
  });

  it('refuses identity, provenance and history, each with a reason, whatever the setting', () => {
    for (const policy of [LOCKED, EDITABLE]) {
      for (const field of ['id', 'type', 'created_at']) {
        expect(refusalFor(field, policy), field).toEqual(expect.any(String));
      }
    }
  });

  it('refuses username, naming the setting, while it is off', () => {
    expect(refusalFor('username', LOCKED)).toBe(
      'this tenant has not enabled username editing (username_editable)',
    );
    expect(refusalFor('username', EDITABLE)).toBeNull();
  });

  it('gives an amendable field no refusal', () => {
    expect(refusalFor('email', LOCKED)).toBeNull();
    expect(refusalFor('enabled', LOCKED)).toBeNull();
  });

  it('gives a field this resource has never heard of no refusal either', () => {
    // refusalFor only names a reason for a field it actually knows about —
    // the usecase, not this leaf, is what tells "excluded" from "unknown".
    expect(refusalFor('secret_hash', LOCKED)).toBeNull();
  });

  it('accounts for every field of the subject wire shape', () => {
    // A field added to subjectSchema later is either amendable or refused
    // with a reason — never silently neither, which is how a field becomes
    // unreachable.
    for (const field of SUBJECT_FIELDS) {
      const known =
        amendableSubjectFields(LOCKED).includes(field) || refusalFor(field, LOCKED) !== null;
      expect(known, field).toBe(true);
    }
  });
});
