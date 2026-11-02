import { expect, it } from 'vitest';
import {
  RESTORE_CONFIRM_LABEL,
  RESTORE_DIALOG_TITLE,
  restoredText,
  restoreFailureText,
  restoreHeld,
  restoreOffer,
  restoreText,
} from '#/features/scopes/services';

const items = (missing: readonly string[]) =>
  ['openid', 'roles', 'groups'].map((name) => ({ name, present: !missing.includes(name) }));

it('judges the built-ins read: some missing, none missing, unknown or not yet read', () => {
  expect(restoreOffer({ status: 'ready', data: { items: items(['roles', 'groups']) } })).toEqual({
    kind: 'missing',
    names: ['roles', 'groups'],
  });
  expect(restoreOffer({ status: 'ready', data: { items: items([]) } })).toEqual({
    kind: 'nothing',
  });
  expect(restoreOffer({ status: 'loading' })).toEqual({ kind: 'reading' });
  expect(restoreOffer({ status: 'failed', refused: false, retry: () => undefined })).toEqual({
    kind: 'unknown',
  });
});

it('says what a restore would create, and what it would not bring back', () => {
  expect(restoreText({ kind: 'missing', names: ['roles'] })).toBe(
    'roles is missing. Restoring creates it again with the settings a new tenant is given. ' +
      'It does not bring back the client assignments and role mappings that went with it: assign it to clients and map roles again.',
  );
  expect(restoreText({ kind: 'missing', names: ['roles', 'groups'] })).toBe(
    'roles and groups are missing. Restoring creates them again with the settings a new tenant is given. ' +
      'It does not bring back the client assignments and role mappings that went with them: assign them to clients and map roles again.',
  );
});

it('says there is nothing to restore, and never offers a restore it could not name', () => {
  expect(restoreText({ kind: 'nothing' })).toBe(
    'Every built-in scope is present, so there is nothing to restore.',
  );
  expect(restoreText({ kind: 'reading' })).toBe('Checking which built-in scopes this tenant has.');
  expect(restoreText({ kind: 'unknown' })).toBe(
    'Which built-in scopes this tenant has could not be read.',
  );
});

it('holds the confirmation unless something is known to be missing', () => {
  expect(restoreHeld({ kind: 'missing', names: ['roles'] })).toBe(false);
  expect(restoreHeld({ kind: 'nothing' })).toBe(true);
  expect(restoreHeld({ kind: 'reading' })).toBe(true);
  expect(restoreHeld({ kind: 'unknown' })).toBe(true);
});

it('reports what was created, or that nothing was missing', () => {
  expect(restoredText(['roles', 'groups'])).toBe(
    'Restored roles and groups. Assign them to clients and map roles again where they are needed.',
  );
  expect(restoredText(['roles'])).toBe(
    'Restored roles. Assign it to clients and map roles again where it is needed.',
  );
  expect(restoredText([])).toBe('Every built-in scope was already present.');
});

it('says why a refused restore was, and a lost answer as unknown', () => {
  expect(
    restoreFailureText({
      ok: false,
      kind: 'problem',
      problem: {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'a tenant defines at most 1000 scopes',
      },
    }),
  ).toBe('The restore of the built-in scopes was not done: a tenant defines at most 1000 scopes');
  expect(restoreFailureText({ ok: false, kind: 'network' })).toMatch(
    /Could not confirm whether the restore of the built-in scopes was done/u,
  );
});

it('words the dialog that asks for the restore', () => {
  expect(RESTORE_DIALOG_TITLE).toBe('Restore built-in scopes?');
  expect(RESTORE_CONFIRM_LABEL).toBe('Restore');
});
