import { describe, expect, it } from 'vitest';
import {
  chooseSurvivor,
  credentialTypesToMove,
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
  it('merges every other account into the survivor', () => {
    const plan = planGroup([
      account('a', '2026-01-01T00:00:00Z'),
      account('b', '2026-02-01T00:00:00Z'),
      account('c', '2026-03-01T00:00:00Z'),
    ]);
    expect(plan).toEqual({
      kind: 'merge',
      survivorId: 'a',
      losers: [
        { subjectId: 'b', carriesOver: true },
        { subjectId: 'c', carriesOver: true },
      ],
    });
  });

  it('refuses when two accounts have signed in, whichever would survive', () => {
    expect(
      planGroup([
        account('a', '2026-01-01T00:00:00Z', { hasSignIns: true }),
        account('b', '2026-02-01T00:00:00Z', { hasSignIns: true }),
      ]),
    ).toEqual({ kind: 'refused', reason: 'several_have_sign_ins' });
  });

  it('refuses a whole group of three when two of them have signed in', () => {
    expect(
      planGroup([
        account('a', '2026-01-01T00:00:00Z'),
        account('b', '2026-02-01T00:00:00Z', { hasSignIns: true }),
        account('c', '2026-03-01T00:00:00Z', { hasSignIns: true }),
      ]),
    ).toEqual({ kind: 'refused', reason: 'several_have_sign_ins' });
  });

  it('merges when only the account that does not survive has signed in', () => {
    expect(
      planGroup([
        account('a', '2026-01-01T00:00:00Z'),
        account('b', '2026-02-01T00:00:00Z', { hasSignIns: true }),
      ]),
    ).toMatchObject({ kind: 'merge', survivorId: 'a' });
  });

  it('carries nothing over from an unverified account to a verified survivor', () => {
    expect(
      planGroup([
        account('a', '2026-02-01T00:00:00Z', { emailVerified: true }),
        account('b', '2026-01-01T00:00:00Z'),
      ]),
    ).toEqual({
      kind: 'merge',
      survivorId: 'a',
      losers: [{ subjectId: 'b', carriesOver: false }],
    });
  });

  it('refuses when the unverified account that would be left behind has signed in', () => {
    expect(
      planGroup([
        account('a', '2026-02-01T00:00:00Z', { emailVerified: true }),
        account('b', '2026-01-01T00:00:00Z', { hasSignIns: true }),
      ]),
    ).toEqual({ kind: 'refused', reason: 'unverified_account_has_sign_ins' });
  });

  it('carries over from a verified account to a verified survivor', () => {
    expect(
      planGroup([
        account('a', '2026-01-01T00:00:00Z', { emailVerified: true }),
        account('b', '2026-02-01T00:00:00Z', { emailVerified: true, hasSignIns: true }),
      ]),
    ).toMatchObject({ kind: 'merge', losers: [{ subjectId: 'b', carriesOver: true }] });
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
