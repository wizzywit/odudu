import { expect, it } from 'vitest';
import {
  CONSENT_RULE,
  guardedConsent,
  displayOrderProblem,
  generalPatch,
  scopeFailureFields,
} from '#/features/scopes/service';

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

it('states the consent limit', () => {
  expect(CONSENT_RULE).toMatch(/500/u);
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

it('holds the consent save, and says why under the field, once the order is edited to a bad one', () => {
  const section = (
    order: string,
    changed: readonly string[],
    fieldErrors: Readonly<Partial<Record<string, string>>>,
    blocked: string | undefined,
  ) => ({ values: { display_order: order }, changed, fieldErrors, blocked, phase: 'ready' });
  expect(guardedConsent(section('3', ['display_order'], {}, undefined))).toEqual(
    section('3', ['display_order'], {}, undefined),
  );
  const bad = guardedConsent(section('x', ['display_order'], { consent_text: 'long' }, undefined));
  expect(bad.blocked).toBe('Enter a whole number, zero or more.');
  expect(bad.fieldErrors).toEqual({
    display_order: 'Enter a whole number, zero or more.',
    consent_text: 'long',
  });
  expect(bad.phase).toBe('ready');
  expect(guardedConsent(section('x', [], {}, undefined)).fieldErrors).toEqual({});
  expect(guardedConsent(section('3', [], {}, 'Keep yours or take theirs.')).blocked).toBe(
    'Keep yours or take theirs.',
  );
});
