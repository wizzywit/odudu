import { expect, it } from 'vitest';
import {
  GUARDED_TEXT,
  guardedText,
  isGuarded,
  scopeDeleteConsequence,
  scopeDeleteFailureText,
} from '#/features/scopes/services/guard';

it('guards openid, and only openid', () => {
  expect(isGuarded('openid')).toBe(true);
  expect(isGuarded('OpenID')).toBe(false);
  expect(isGuarded('profile')).toBe(false);
});

it('says why openid stays, in words of its own', () => {
  expect(GUARDED_TEXT).toMatch(/openid/u);
  expect(GUARDED_TEXT).toMatch(/administrator/u);
});

it('says what a delete takes with it', () => {
  expect(scopeDeleteConsequence('billing')).toMatch(
    /every client assigned billing .* every role mapped to it/u,
  );
});

it('words a refused delete by the ceiling, and a lost answer as unknown', () => {
  expect(
    scopeDeleteFailureText('billing', {
      ok: false,
      kind: 'problem',
      problem: {
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'this removes capabilities the caller does not hold: manage-keys',
      },
    }),
  ).toMatch(/^Refused: it would take manage-keys/u);
  expect(scopeDeleteFailureText('billing', { ok: false, kind: 'network' })).toMatch(
    /Could not confirm whether billing was deleted/u,
  );
});

it('says why a guarded scope stays, and nothing of any other', () => {
  expect(guardedText('openid')).toBe(GUARDED_TEXT);
  expect(guardedText('profile')).toBeNull();
});
