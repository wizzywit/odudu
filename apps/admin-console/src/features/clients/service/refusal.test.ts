import { expect, it } from 'vitest';
import { clientRefusal } from '#/features/clients/service/refusal.ts';

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
