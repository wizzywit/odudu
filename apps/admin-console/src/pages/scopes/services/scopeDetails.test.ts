import { expect, it } from 'vitest';
import {
  NAME_FIXED,
  displayOrderProblem,
  generalPatch,
  scopeFailureFields,
} from '#/pages/scopes/services/scopeDetails';

it('accepts a whole number from zero, and nothing else', () => {
  expect(displayOrderProblem('0')).toBeNull();
  expect(displayOrderProblem('12')).toBeNull();
  expect(displayOrderProblem('')).toMatch(/whole number/u);
  expect(displayOrderProblem('-1')).toMatch(/whole number/u);
  expect(displayOrderProblem('1.5')).toMatch(/whole number/u);
  expect(displayOrderProblem('2147483648')).toMatch(/at most/u);
});

it('sends an emptied description or consent text as null, a number as a number', () => {
  expect(generalPatch({ description: '' })).toEqual({ description: null });
  expect(generalPatch({ consent_text: '  ' })).toEqual({ consent_text: null });
  expect(generalPatch({ display_order: '4', include_in_id_token: true })).toEqual({
    display_order: 4,
    include_in_id_token: true,
  });
  expect(generalPatch({ default_client_assignment: 'none' })).toEqual({
    default_client_assignment: null,
  });
  expect(generalPatch({ default_client_assignment: 'optional' })).toEqual({
    default_client_assignment: 'optional',
  });
});

it('sends a translation map whole, and only when it was edited', () => {
  expect(generalPatch({ description_i18n: { fr: 'Factures' } })).toEqual({
    description_i18n: { fr: 'Factures' },
  });
  expect(generalPatch({ consent_text_i18n: {} })).toEqual({ consent_text_i18n: {} });
  expect(generalPatch({ description: 'x' })).toEqual({ description: 'x' });
});

it('places a refusal under the fields the form has', () => {
  expect(scopeFailureFields).toEqual([
    'name',
    'description',
    'include_in_id_token',
    'include_in_access_token',
    'default_client_assignment',
    'consent_text',
    'display_order',
    'description_i18n',
    'consent_text_i18n',
  ]);
});

it('says a scope name is fixed because a client asks for it and a token carries it', () => {
  expect(NAME_FIXED).toBe(
    "A scope's name is the token a client asks for and a token carries, so it is fixed once the scope is made. Make a new scope and assign it instead.",
  );
});
