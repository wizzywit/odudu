import { describe, expect, it } from 'vitest';
import { AMENDABLE_SUBJECT_FIELDS, refusalFor, SUBJECT_FIELDS } from '#/service/subjects-patch';

describe('the subject amendment allowlist', () => {
  it('admits email and enabled, and nothing else', () => {
    expect(AMENDABLE_SUBJECT_FIELDS).toEqual(['email', 'enabled']);
  });

  it('refuses identity, provenance and history, each with a reason', () => {
    for (const field of ['id', 'type', 'username', 'created_at']) {
      expect(refusalFor(field), field).toEqual(expect.any(String));
    }
  });

  it('gives an amendable field no refusal', () => {
    expect(refusalFor('email')).toBeNull();
    expect(refusalFor('enabled')).toBeNull();
  });

  it('gives a field this resource has never heard of no refusal either', () => {
    // refusalFor only names a reason for a field it actually knows about —
    // the usecase, not this leaf, is what tells "excluded" from "unknown".
    expect(refusalFor('secret_hash')).toBeNull();
  });

  it('accounts for every field of the subject wire shape', () => {
    // A field added to subjectSchema later is either amendable or refused
    // with a reason — never silently neither, which is how a field becomes
    // unreachable.
    for (const field of SUBJECT_FIELDS) {
      const known = AMENDABLE_SUBJECT_FIELDS.includes(field) || refusalFor(field) !== null;
      expect(known, field).toBe(true);
    }
  });
});
