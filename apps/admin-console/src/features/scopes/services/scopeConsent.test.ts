import { expect, it } from 'vitest';
import { CONSENT_RULE, guardedConsent } from '#/features/scopes/services/scopeConsent';

it('states the consent limit', () => {
  expect(CONSENT_RULE).toMatch(/500/u);
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
