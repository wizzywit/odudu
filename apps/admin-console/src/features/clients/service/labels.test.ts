import { expect, it } from 'vitest';
import { registeredText, TYPE_TEXT } from '#/features/clients/service/labels.ts';

it('says how a client came to be, in a phrase a person reads', () => {
  expect(registeredText('operator')).toBe('Created by an administrator');
  expect(registeredText('token')).toBe('Registered dynamically, with a registration token');
  expect(registeredText('unheard-of')).toBe('unheard-of');
});

it('names the two types', () => {
  expect(TYPE_TEXT).toEqual({ confidential: 'Confidential', public: 'Public' });
});
