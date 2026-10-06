import { expect, it } from 'vitest';
import { ceilingRefused, clientRefusal } from '#/features/clients/service/refusal.ts';

const refused = (detail: string | undefined) => ({
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  instance: 'r',
  ...(detail === undefined ? {} : { detail }),
});

it('names manage-clients when a 403 says nothing more', () => {
  expect(clientRefusal(refused(undefined))).toBe(
    'Refused: it needs the manage-clients capability, or reaches a capability you do not hold.',
  );
});

it("keeps the server's reason for the service account's ceiling", () => {
  expect(
    clientRefusal(
      refused("the client's service account holds what the caller does not: manage-users"),
    ),
  ).toBe("Refused: the client's service account holds what the caller does not: manage-users.");
});

it('leaves a validation problem to its field', () => {
  expect(clientRefusal({ ...refused('x'), status: 400 })).toBeNull();
});

const problemOf = (status: number, detail?: string) =>
  ({
    ok: false,
    kind: 'problem',
    status,
    problem: {
      type: 'about:blank',
      title: 'Refused',
      status,
      instance: 'r',
      ...(detail === undefined ? {} : { detail }),
    },
  }) as const;

it('knows a refusal by the service account ceiling, which says the record it was judged on is out of date', () => {
  expect(
    ceilingRefused(
      problemOf(403, "the client's service account holds what the caller does not: manage-users"),
    ),
  ).toBe(true);
  expect(ceilingRefused(problemOf(403, 'the caller does not hold: view-users'))).toBe(false);
  expect(ceilingRefused(problemOf(403))).toBe(false);
  expect(
    ceilingRefused(problemOf(409, "the client's service account holds what the caller does not")),
  ).toBe(false);
  expect(ceilingRefused({ ok: false, kind: 'network' })).toBe(false);
});
