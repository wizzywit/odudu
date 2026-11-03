import { describe, expect, it } from 'vitest';
import { compositesFixed } from '#/features/roles/services/composites';
import {
  deletionFixed,
  deleteBlock,
  isBuiltin,
  roleDeleteConsequence,
  roleDeleteFailureText,
} from '#/features/roles/services/roleDeletion';
import { defaultBlock } from '#/features/roles/services/roleDefault';
import { role } from '#/testing/roleAnswers';
import { refusedWith } from '#/testing/failures';

const READER = role('r-read', 'reader');

const USERS = role('r-users', 'manage-users', 'odudu-admin', ['view-users', 'manage-users']);

describe('the built-in roles', () => {
  it('are the roles of the built-in admin client, whatever their name', () => {
    expect(isBuiltin(USERS)).toBe(true);
    expect(isBuiltin(role('r-x', 'manage-users', 'portal'))).toBe(false);
  });
  it('are never deleted, never made a default and keep their composites', () => {
    expect(deleteBlock(USERS, [])).toBe(
      'manage-users is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.',
    );
    expect(defaultBlock(USERS)).toBe(
      'A capability of the built-in admin client is never handed to every new subject.',
    );
  });
});

describe('the built-in sentences', () => {
  it('say what a capability role keeps, and that it is never deleted', () => {
    expect(compositesFixed(READER)).toBeNull();
    expect(compositesFixed(USERS)).toBe(
      'manage-users is a capability of the built-in admin client: it keeps the roles it was provisioned with, and nothing is nested in it or taken out of it here.',
    );
    expect(deletionFixed(READER)).toBeNull();
    expect(deletionFixed(USERS)).toBe(
      'manage-users is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.',
    );
  });
});

const AUDITOR = role('r-aud', 'auditor');

// A tenant role nesting a capability two levels down.
const DEEP = role('r-deep', 'deep', null, ['view-audit']);

describe('the ceiling on a role, by what the server says it reaches', () => {
  it('holds a delete back when what the role reaches is beyond the caller', () => {
    expect(deleteBlock(DEEP, ['manage-tenant'])).toBe(
      'deep reaches view-audit, which you do not hold, so you cannot delete it.',
    );
    expect(deleteBlock(AUDITOR, ['manage-tenant'])).toBeNull();
  });
});

const certain = { kind: 'certain', lost: ['view-audit'] } as const;

describe('deleting a role', () => {
  it('says what it comes to, with the loss appended', () => {
    expect(roleDeleteConsequence('reader', { kind: 'none' })).toBe(
      'reader is taken from every subject, group and scope it is given to, and out of every role it is nested in; what it nests is no longer held through it. It cannot be undone.',
    );
    expect(roleDeleteConsequence('reader', certain)).toContain(
      ' You hold view-audit through reader, so this takes it from you',
    );
  });
  it('words a failed delete, the server own reason for a refusal first', () => {
    expect(roleDeleteFailureText('reader', refusedWith(409, 'still in use'))).toBe(
      'Refused: still in use.',
    );
    expect(roleDeleteFailureText('reader', refusedWith(500, 'boom'))).toBe(
      'reader was not deleted: boom',
    );
    expect(roleDeleteFailureText('reader', refusedWith(403, 'x'))).toBe('Refused: x.');
    expect(roleDeleteFailureText('reader', { ok: false, kind: 'network' })).toBe(
      'Could not confirm whether reader was deleted. It has not been sent again; look at the roles before trying again.',
    );
  });
});
