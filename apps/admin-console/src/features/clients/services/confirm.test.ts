import { expect, it } from 'vitest';
import { deleteConsequence } from '#/features/clients/services/confirm';

it('says what a delete takes with it, and that it stays deleted', () => {
  const text = deleteConsequence('Billing');
  expect(text).toContain('Deleting Billing deletes the client and every role scoped to it');
  expect(text).toContain('cannot be undone');
});
