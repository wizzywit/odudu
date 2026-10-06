import { expect, it } from 'vitest';
import {
  afterCreation,
  asksRedirects,
  clientIdProblem,
  KIND_CHOICES,
  NEW_CLIENT_FIELDS,
  newClientKind,
  secretTitle,
  splitSecret,
} from '#/features/clients/service/create.ts';

it('offers a web application, a service and a public client, saying which holds a secret', () => {
  expect(KIND_CHOICES.map((choice) => choice.id)).toEqual(['confidential', 'service', 'public']);
  expect(KIND_CHOICES[0]?.description).toContain('client secret, shown once');
  expect(KIND_CHOICES[1]?.description).toContain('client secret, shown once');
  expect(KIND_CHOICES[2]?.description).toContain('has no secret');
});

it('asks for redirect URIs of every kind but a service, which signs nobody in', () => {
  expect(asksRedirects('confidential')).toBe(true);
  expect(asksRedirects('public')).toBe(true);
  expect(asksRedirects('service')).toBe(false);
});

it('requires a client ID, and places a refusal under the fields the API names', () => {
  expect(clientIdProblem('  ')).toBe('Enter a client ID.');
  expect(clientIdProblem('billing')).toBeNull();
  expect(NEW_CLIENT_FIELDS).toEqual(['client_id', 'name', 'description', 'redirect_uris']);
  expect(secretTitle('Billing')).toBe('Client secret for Billing');
});

it('narrows what a select hands back to a kind, confidential for anything else', () => {
  expect(newClientKind('public')).toBe('public');
  expect(newClientKind('service')).toBe('service');
  expect(newClientKind('nonsense')).toBe('confidential');
});

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
