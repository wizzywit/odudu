import { expect, it } from 'vitest';
import {
  chosenClient,
  clientAssignmentFailure,
  clientsOffered,
  clientsCount,
} from '#/pages/scopes/services/scopeClients';

it('counts what is loaded', () => {
  expect(clientsCount(1, false)).toBe('1 client.');
  expect(clientsCount(50, true)).toBe('50 clients shown, with more to load.');
});

it('names the bound a client holds when the server refuses over it', () => {
  expect(
    clientAssignmentFailure(
      {
        ok: false,
        kind: 'problem',
        problem: {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: 'a client carries at most 200 scopes',
        },
      },
      'billing',
      'Billing UI',
      'assigned',
    ),
  ).toMatch(/a client carries at most 200 scopes/u);
});

it('offers the client search once whoami has answered and names nothing missing', () => {
  expect(clientsOffered(false, [])).toBe(false);
  expect(clientsOffered(true, ['manage-clients'])).toBe(false);
  expect(clientsOffered(true, [])).toBe(true);
});

it('finds the chosen client among the options, and none for no choice', () => {
  const options = [{ id: 'a' }, { id: 'b' }];
  expect(chosenClient(options, 'b')).toEqual({ id: 'b' });
  expect(chosenClient(options, 'z')).toBeNull();
  expect(chosenClient(options, null)).toBeNull();
});
