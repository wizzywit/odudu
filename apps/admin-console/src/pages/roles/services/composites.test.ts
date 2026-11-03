import { describe, expect, it } from 'vitest';
import {
  addRefusal,
  childRows,
  childUnavailable,
  compositeRemovalConfirmation,
  compositeRemovalFailureText,
  unnestedText,
  compositeRefusal,
} from '#/pages/roles/services/composites';
import { role } from '#/testing/roleAnswers';
import { roleReachUnavailable } from '#/shared/services/capabilities';
import { refusedWith, failure, refusal } from '#/testing/failures';
import { type GatewayFailure } from '#/shared/services/result';

const READER = role('r-read', 'reader');

const USERS = role('r-users', 'manage-users', 'odudu-admin', ['view-users', 'manage-users']);

describe('adding a composite', () => {
  it('names the role chosen in a refusal, and leaves other refusals to the shared wording', () => {
    expect(
      addRefusal({
        type: 'about:blank',
        status: 409,
        detail: 'would create a role composite cycle',
      }),
    ).toBe(
      'Refused: the role chosen already includes this role, so nesting it here would make a loop.',
    );
    expect(addRefusal({ type: 'about:blank', status: 500 })).toBeNull();
  });
});

describe('childRows', () => {
  it('says for each child why it cannot be taken out here, or that it can', () => {
    expect(childRows([READER, USERS], ['view-users'], 'acme')).toEqual([
      { role: READER, held: null },
      { role: USERS, held: expect.stringContaining('manage-users') as string },
    ]);
    expect(childRows([], ['view-users'], 'acme')).toEqual([]);
  });
});

describe('childUnavailable', () => {
  const parent = { id: 'r-parent', default_for_new_subjects: false };
  const reaching = role('r-bundle', 'bundle', null, ['view-users']);
  it('refuses a role nested in itself or nested already, before judging its reach', () => {
    expect(childUnavailable(parent, role('r-parent', 'p'), [], ['view-users'], 'acme')).toBe(
      'this role itself',
    );
    expect(childUnavailable(parent, READER, [READER], ['view-users'], 'acme')).toBe(
      'nested here already',
    );
  });
  it('refuses a role reaching an admin capability under a default, in its own sentence', () => {
    expect(
      childUnavailable({ ...parent, default_for_new_subjects: true }, reaching, [], [], 'acme'),
    ).toBe('Every new subject receives this role, so it may nest no admin capability.');
    expect(
      childUnavailable({ ...parent, default_for_new_subjects: true }, READER, [], [], 'acme'),
    ).toBeNull();
  });
  it('leaves a role beyond the caller to the shared ceiling wording', () => {
    expect(childUnavailable(parent, reaching, [], [], 'acme')).toBe(
      'It reaches view-users, which you do not hold, so you cannot give or take it.',
    );
    expect(childUnavailable(parent, reaching, [], ['view-users'], 'acme')).toBeNull();
  });
});

const AUDITOR = role('r-aud', 'auditor');

const FULL = role('r-full', 'tenant-admin', 'odudu-admin', ['view-users', 'manage-users']);

// A tenant role nesting a capability two levels down.
const DEEP = role('r-deep', 'deep', null, ['view-audit']);

const certain = { kind: 'certain', lost: ['view-audit'] } as const;

describe('the ceiling on a role, by what the server says it reaches', () => {
  it('says why a role cannot be nested here, or taken out', () => {
    expect(childUnavailable(AUDITOR, AUDITOR, [], ['manage-users'], 'acme')).toBe(
      'this role itself',
    );
    expect(childUnavailable(AUDITOR, READER, [READER], ['manage-users'], 'acme')).toBe(
      'nested here already',
    );
    expect(childUnavailable(AUDITOR, FULL, [], ['manage-users'], 'acme')).toBe(
      'Full carries capabilities you do not hold, so you cannot give or take it.',
    );
    expect(childUnavailable(AUDITOR, DEEP, [], ['manage-users'], 'acme')).toBe(
      'It reaches view-audit, which you do not hold, so you cannot give or take it.',
    );
    expect(
      childUnavailable(
        { ...AUDITOR, default_for_new_subjects: true },
        DEEP,
        [],
        ['view-audit'],
        'acme',
      ),
    ).toBe('Every new subject receives this role, so it may nest no admin capability.');
    expect(roleReachUnavailable(USERS, ['view-users'], 'acme')).toBe(
      'You do not hold manage-users, so you cannot give or take it.',
    );
    expect(roleReachUnavailable(READER, [], 'acme')).toBeNull();
  });
  it('says what a refused nesting means where it was asked', () => {
    expect(
      compositeRefusal('reader', {
        type: 'about:blank',
        status: 409,
        detail: 'would create a role composite cycle',
      }),
    ).toBe('Refused: reader already includes this role, so nesting it here would make a loop.');
    expect(compositeRefusal('reader', { type: 'about:blank', status: 409, detail: 'no' })).toBe(
      'Refused: no.',
    );
  });
});

describe('the composites a role offers', () => {
  it('says what taking one out comes to', () => {
    expect(compositeRemovalConfirmation('reader', 'auditor', certain)).toEqual({
      title: 'Take out a role your own access runs through?',
      consequence:
        'Whoever holds reader no longer holds auditor through it. You hold view-audit through auditor nested in reader, so this takes it from you, and this console with it.',
    });
    expect(unnestedText('auditor', 'reader')).toBe('auditor is no longer nested in reader.');
  });
  it('words a failed removal by what happened to the edge', () => {
    expect(compositeRemovalFailureText('reader', 'auditor', refusedWith(412))).toBe(
      "reader's composites changed since you opened them, so auditor was not taken out. They have been read again; look before trying again.",
    );
    expect(
      compositeRemovalFailureText(
        'reader',
        'auditor',
        refusedWith(409, 'would create a role composite cycle'),
      ),
    ).toBe('Refused: auditor already includes this role, so nesting it here would make a loop.');
    expect(compositeRemovalFailureText('reader', 'auditor', refusedWith(500, 'boom'))).toBe(
      'auditor was not taken out: boom',
    );
    for (const kind of ['network', 'schema', 'defect'] as const) {
      expect(compositeRemovalFailureText('reader', 'auditor', { ok: false, kind })).toBe(
        'Could not confirm whether auditor was taken out. Look at the list before trying again.',
      );
    }
  });
});

describe('compositeRemovalFailureText', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'viewer was not taken out: D400'],
    [
      '403',
      refusal(403),
      'Refused: it needs the manage-tenant capability, or reaches a capability you do not hold.',
    ],
    ['404', refusal(404), 'viewer was not taken out: T404'],
    ['409', refusal(409, { detail: 'D409' }), 'Refused: D409.'],
    [
      '412',
      refusal(412),
      "admin's composites changed since you opened them, so viewer was not taken out. They have been read again; look before trying again.",
    ],
    ['413', refusal(413), 'viewer was not taken out: T413'],
    ['502', refusal(502, { detail: 'D502' }), 'viewer was not taken out: D502'],
    [
      'network',
      failure('network'),
      'Could not confirm whether viewer was taken out. Look at the list before trying again.',
    ],
    [
      'schema',
      failure('schema'),
      'Could not confirm whether viewer was taken out. Look at the list before trying again.',
    ],
    [
      'defect',
      failure('defect'),
      'Could not confirm whether viewer was taken out. Look at the list before trying again.',
    ],
    ['403 detail', refusal(403, { detail: 'D403' }), 'Refused: D403.'],
    ['400 title', refusal(400), 'viewer was not taken out: T400'],
    ['500 title', refusal(500), 'viewer was not taken out: T500'],
    [
      '400 too broad',
      refusal(400, { type: 'about:blank#audit-query-too-broad' }),
      'viewer was not taken out: T400',
    ],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(compositeRemovalFailureText('admin', 'viewer', failure)).toBe(text);
  });
});
