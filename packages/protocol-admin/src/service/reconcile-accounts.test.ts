import { describe, expect, it } from 'vitest';
import {
  accountFacts,
  chooseSurvivor,
  credentialTypesToMove,
  hasSignedIn,
  movePlan,
  planGroup,
  type AccountFacts,
} from '#/service/reconcile-accounts';

function account(
  subjectId: string,
  createdAt: string,
  overrides: Partial<AccountFacts> = {},
): AccountFacts {
  return {
    subjectId,
    email: `${subjectId}@example.test`,
    createdAt: new Date(createdAt),
    emailVerified: false,
    hasSignIns: false,
    ...overrides,
  };
}

describe('which account survives', () => {
  const cases: readonly {
    readonly name: string;
    readonly members: readonly AccountFacts[];
    readonly survivor: string;
  }[] = [
    {
      name: 'the verified address, though it is the younger',
      members: [
        account('a', '2026-01-01T00:00:00Z'),
        account('b', '2026-06-01T00:00:00Z', { emailVerified: true }),
      ],
      survivor: 'b',
    },
    {
      name: 'the oldest of two unverified accounts',
      members: [account('a', '2026-06-01T00:00:00Z'), account('b', '2026-01-01T00:00:00Z')],
      survivor: 'b',
    },
    {
      name: 'the oldest of the verified ones',
      members: [
        account('a', '2026-06-01T00:00:00Z', { emailVerified: true }),
        account('b', '2026-03-01T00:00:00Z', { emailVerified: true }),
        account('c', '2026-01-01T00:00:00Z'),
      ],
      survivor: 'b',
    },
    {
      name: 'the account that has signed in, between two verified ones, though it is younger',
      members: [
        account('a', '2026-01-01T00:00:00Z', { emailVerified: true }),
        account('b', '2026-06-01T00:00:00Z', { emailVerified: true, hasSignIns: true }),
      ],
      survivor: 'b',
    },
    {
      name: 'a verified account over an unverified one that has signed in',
      members: [
        account('a', '2026-06-01T00:00:00Z', { emailVerified: true }),
        account('b', '2026-01-01T00:00:00Z', { hasSignIns: true }),
      ],
      survivor: 'a',
    },
    {
      name: 'the lowest id when two were made at the same instant',
      members: [account('b', '2026-01-01T00:00:00Z'), account('a', '2026-01-01T00:00:00Z')],
      survivor: 'a',
    },
  ];

  it.each(cases)('chooses $name', ({ members, survivor }) => {
    expect(chooseSurvivor(members).subjectId).toBe(survivor);
  });

  it('is the same whatever order the accounts arrive in', () => {
    const members = [
      account('a', '2026-03-01T00:00:00Z'),
      account('b', '2026-02-01T00:00:00Z', { emailVerified: true }),
      account('c', '2026-01-01T00:00:00Z', { emailVerified: true }),
    ];
    expect(chooseSurvivor([...members].reverse()).subjectId).toBe('c');
  });
});

describe('what a group of same-address accounts is planned as', () => {
  const verified = { emailVerified: true };

  it('merges every other account into the survivor', () => {
    const plan = planGroup([
      account('a', '2026-01-01T00:00:00Z', verified),
      account('b', '2026-02-01T00:00:00Z', verified),
      account('c', '2026-03-01T00:00:00Z', verified),
    ]);
    expect(plan).toMatchObject({
      kind: 'merge',
      survivorId: 'a',
      losers: [
        { subjectId: 'b', email: 'b@example.test', carriesOver: true },
        { subjectId: 'c', email: 'c@example.test', carriesOver: true },
      ],
    });
  });

  it('is nothing when fewer than two accounts hold the address', () => {
    expect(planGroup([account('a', '2026-01-01T00:00:00Z', verified)])).toEqual({ kind: 'gone' });
    expect(planGroup([])).toEqual({ kind: 'gone' });
  });

  it('refuses when two accounts have signed in, whichever would survive', () => {
    expect(
      planGroup([
        account('a', '2026-01-01T00:00:00Z', { ...verified, hasSignIns: true }),
        account('b', '2026-02-01T00:00:00Z', { ...verified, hasSignIns: true }),
      ]),
    ).toEqual({ kind: 'refused', reason: 'several_have_sign_ins' });
  });

  it('refuses a whole group of three when two of them have signed in', () => {
    expect(
      planGroup([
        account('a', '2026-01-01T00:00:00Z', verified),
        account('b', '2026-02-01T00:00:00Z', { ...verified, hasSignIns: true }),
        account('c', '2026-03-01T00:00:00Z', { hasSignIns: true }),
      ]),
    ).toEqual({ kind: 'refused', reason: 'several_have_sign_ins' });
  });

  it('refuses a group where no account has a verified address, and moves nothing', () => {
    expect(
      planGroup([account('a', '2026-01-01T00:00:00Z'), account('b', '2026-02-01T00:00:00Z')]),
    ).toEqual({ kind: 'refused', reason: 'no_verified_account' });
  });

  it('keeps the verified account that has signed in, and folds the older one into it', () => {
    expect(
      planGroup([
        account('a', '2026-01-01T00:00:00Z', verified),
        account('b', '2026-02-01T00:00:00Z', { ...verified, hasSignIns: true }),
      ]),
    ).toMatchObject({ kind: 'merge', survivorId: 'b', losers: [{ subjectId: 'a' }] });
  });

  it('carries nothing over from an unverified account to a verified survivor', () => {
    expect(
      planGroup([
        account('a', '2026-02-01T00:00:00Z', verified),
        account('b', '2026-01-01T00:00:00Z'),
      ]),
    ).toMatchObject({
      kind: 'merge',
      survivorId: 'a',
      losers: [{ subjectId: 'b', carriesOver: false }],
    });
  });

  it('refuses when the unverified account that would be left behind has signed in', () => {
    expect(
      planGroup([
        account('a', '2026-02-01T00:00:00Z', verified),
        account('b', '2026-01-01T00:00:00Z', { hasSignIns: true }),
      ]),
    ).toEqual({ kind: 'refused', reason: 'unverified_account_has_sign_ins' });
  });
});

describe('what counts as having signed in', () => {
  const none = { session: false, grant: false, usedCredential: false, loginEvent: false };

  it.each(['session', 'grant', 'usedCredential', 'loginEvent'] as const)(
    'counts a %s alone',
    (trace) => {
      expect(hasSignedIn({ ...none, [trace]: true })).toBe(true);
    },
  );

  it('counts a password-only person whose sessions are gone but whose sign-in was audited', () => {
    expect(hasSignedIn({ ...none, loginEvent: true })).toBe(true);
  });

  it('counts nothing for an account with no trace at all', () => {
    expect(hasSignedIn(none)).toBe(false);
  });

  it('is carried into the facts the plan reads', () => {
    const record = {
      subjectId: 'a',
      email: 'A@x.test',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      emailVerified: false,
    };
    expect(accountFacts({ ...record, traces: { ...none, loginEvent: true } })).toMatchObject({
      subjectId: 'a',
      email: 'A@x.test',
      hasSignIns: true,
    });
    expect(accountFacts({ ...record, traces: none }).hasSignIns).toBe(false);
  });
});

describe('what is moved from an account that goes', () => {
  it('moves nothing from an account that does not carry over', () => {
    expect(movePlan(false, new Set(), new Set(['password', 'webauthn']))).toEqual({
      moveRows: false,
      credentialTypes: [],
      moveRecoveryStamp: false,
    });
  });

  it('moves rows and the credentials the survivor lacks', () => {
    expect(movePlan(true, new Set(['password']), new Set(['password', 'webauthn']))).toEqual({
      moveRows: true,
      credentialTypes: ['webauthn'],
      moveRecoveryStamp: false,
    });
  });

  it('moves the time a recovery set was made only with the set', () => {
    expect(movePlan(true, new Set(), new Set(['recovery-code'])).moveRecoveryStamp).toBe(true);
    expect(
      movePlan(true, new Set(['recovery-code']), new Set(['recovery-code'])).moveRecoveryStamp,
    ).toBe(false);
  });
});

describe('which credentials move to the survivor', () => {
  it('moves every kind the survivor does not hold', () => {
    expect(
      credentialTypesToMove(new Set(), new Set(['password', 'totp', 'webauthn', 'recovery-code'])),
    ).toEqual(['password', 'totp', 'webauthn', 'recovery-code']);
  });

  it('leaves a kind only one of a person can have where the survivor holds it', () => {
    expect(
      credentialTypesToMove(new Set(['password', 'totp']), new Set(['password', 'totp'])),
    ).toEqual([]);
  });

  it('always moves passkeys, of which there can be many', () => {
    expect(credentialTypesToMove(new Set(['webauthn']), new Set(['webauthn']))).toEqual([
      'webauthn',
    ]);
  });

  it('leaves retired password hashes behind when the survivor keeps its own', () => {
    expect(
      credentialTypesToMove(new Set(['password-history']), new Set(['password-history'])),
    ).toEqual([]);
  });

  it('moves nothing the loser does not hold', () => {
    expect(credentialTypesToMove(new Set(), new Set())).toEqual([]);
  });
});
