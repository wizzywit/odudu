import { expect, it } from 'vitest';
import { registeredText } from '#/features/clients/services/clientRedirects';

it('says how a client came to be, in a phrase a person reads', () => {
  expect(registeredText('operator')).toBe('Created by an administrator');
  expect(registeredText('token')).toBe('Registered dynamically, with a registration token');
  expect(registeredText('unheard-of')).toBe('unheard-of');
});
