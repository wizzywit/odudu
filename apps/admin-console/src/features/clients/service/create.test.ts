import { expect, it } from 'vitest';
import {
  clientIdProblem,
  NEW_CLIENT_FIELDS,
  newClientType,
  secretTitle,
  TYPE_CHOICES,
} from '#/features/clients/service/create.ts';

it('offers a confidential and a public client, saying which holds a secret', () => {
  expect(TYPE_CHOICES.map((choice) => choice.id)).toEqual(['confidential', 'public']);
  expect(TYPE_CHOICES[0]?.description).toContain('client secret, shown once');
  expect(TYPE_CHOICES[1]?.description).toContain('has no secret');
});

it('requires a client ID, and places a refusal under the fields the API names', () => {
  expect(clientIdProblem('  ')).toBe('Enter a client ID.');
  expect(clientIdProblem('billing')).toBeNull();
  expect(NEW_CLIENT_FIELDS).toEqual(['client_id', 'name', 'description', 'redirect_uris']);
  expect(secretTitle('Billing')).toBe('Client secret for Billing');
});

it('narrows what a select hands back to a type, confidential for anything else', () => {
  expect(newClientType('public')).toBe('public');
  expect(newClientType('confidential')).toBe('confidential');
  expect(newClientType('nonsense')).toBe('confidential');
});
