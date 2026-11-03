import { expect, it } from 'vitest';
import { afterCreation, secretName, splitSecret } from '#/features/clients/services/createdSecret';

it('splits a secret off an answer, leaving the client without it', () => {
  const answer: { id: string; client_secret?: string } = { id: 'c', client_secret: 's3' };
  expect(splitSecret(answer)).toEqual({ secret: 's3', rest: { id: 'c' } });
  const bare: { id: string; client_secret?: string } = { id: 'c' };
  expect(splitSecret(bare)).toEqual({ secret: null, rest: { id: 'c' } });
});

it('waits for a secret to be acknowledged before the page moves on, and moves on at once without one', () => {
  expect(afterCreation('s3')).toBe('acknowledge');
  expect(afterCreation(null)).toBe('land');
});

it('names the secret for the client made, else for the ID being typed', () => {
  expect(secretName({ name: 'Billing' }, 'billing-web')).toBe('Billing');
  expect(secretName(null, 'billing-web')).toBe('billing-web');
});
