import { expect, it } from 'vitest';
import {
  claimMappersOf,
  impactHeld,
  impactOf,
  impactRetry,
  scopeDeleteDialogText,
  scopeDeleteWarning,
  type Impact,
} from '#/features/scopes/services';

const count = (n: number, capped = false) => ({ count: n, capped });

function counted(clients: number, roles: number, extra: Partial<Impact> = {}): Impact {
  return {
    kind: 'counted',
    builtin: false,
    clients: count(clients),
    roles: count(roles),
    ...extra,
  };
}

it('judges the impact read: counted, unknown or not yet read', () => {
  const data = {
    builtin: true,
    client_assignments: count(4),
    role_mappings: count(25, true),
  };
  expect(impactOf({ status: 'ready', data })).toEqual({
    kind: 'counted',
    builtin: true,
    clients: count(4),
    roles: count(25, true),
  });
  expect(impactOf({ status: 'loading' })).toEqual({ kind: 'reading' });
  expect(impactOf({ status: 'failed', refused: true, retry: () => undefined })).toEqual({
    kind: 'unknown',
  });
});

it('names the bound mappers, else the declared ones, else none', () => {
  expect(claimMappersOf({ bound: ['groups'], declared: ['email'] })).toEqual(['groups']);
  expect(claimMappersOf({ bound: [], declared: ['email'] })).toEqual(['email']);
  expect(claimMappersOf({ bound: [], declared: [] })).toEqual([]);
  expect(claimMappersOf(undefined)).toEqual([]);
});

it('says nothing goes with a scope nothing uses', () => {
  expect(scopeDeleteWarning('billing', counted(0, 0), [])).toBe(
    'No client carries billing, so no client stops receiving its claims. No role is mapped to it.',
  );
});

it('says how many clients stop receiving its claims, and how many roles are unmapped', () => {
  expect(scopeDeleteWarning('billing', counted(1, 1), [])).toBe(
    '1 client carries billing and will stop receiving its claims. 1 role is mapped to it and will be unmapped.',
  );
  expect(scopeDeleteWarning('billing', counted(3, 2), [])).toBe(
    '3 clients carry billing and will stop receiving its claims. 2 roles are mapped to it and will be unmapped.',
  );
});

it('says "or more" for a count that stopped at its ceiling', () => {
  const impact: Impact = {
    kind: 'counted',
    builtin: false,
    clients: count(10_000, true),
    roles: count(1_000, true),
  };
  expect(scopeDeleteWarning('billing', impact, [])).toBe(
    '10,000 or more clients carry billing and will stop receiving its claims. 1,000 or more roles are mapped to it and will be unmapped.',
  );
});

it('never turns an unreadable count into none', () => {
  const text = scopeDeleteWarning('billing', { kind: 'unknown' }, []);
  expect(text).toBe(
    'How many clients carry billing, and how many roles are mapped to it, could not be read. Every one of them goes with it.',
  );
  expect(text).not.toMatch(/\bNo client\b|\bNo role\b|\b0\b/u);
});

it('says the counts are being read while they are', () => {
  expect(scopeDeleteWarning('billing', { kind: 'reading' }, [])).toBe(
    'Checking what this affects…',
  );
});

it('says a built-in scope can be created again, without what it had', () => {
  expect(scopeDeleteWarning('roles', counted(2, 0, { builtin: true }), [])).toBe(
    '2 clients carry roles and will stop receiving its claims. No role is mapped to it. ' +
      'roles is a built-in scope, which every tenant has. Restore built-in scopes on the scopes list creates it again, without the clients and roles it had.',
  );
});

it('names the mappers that produce its claims, where the set is known', () => {
  expect(scopeDeleteWarning('groups', counted(2, 0), ['groups'])).toMatch(
    /Its claims come from the groups mapper\.$/u,
  );
  expect(scopeDeleteWarning('profile', counted(2, 0), ['name', 'email'])).toMatch(
    /Its claims come from the name and email mappers\.$/u,
  );
  expect(scopeDeleteWarning('x', { kind: 'unknown' }, ['groups'])).toMatch(
    /Its claims come from the groups mapper\.$/u,
  );
});

it('puts the warning before what a delete takes with it', () => {
  expect(scopeDeleteDialogText('billing', counted(2, 0), [])).toMatch(
    /^2 clients carry billing and will stop receiving its claims\. No role is mapped to it\. Deleting billing takes it off/u,
  );
});

it('holds the delete until the counts have been read', () => {
  expect(impactHeld({ kind: 'reading' })).toBe(true);
  expect(impactHeld({ kind: 'unknown' })).toBe(true);
  expect(impactHeld(counted(0, 0))).toBe(false);
});

it('offers to read again only when the read failed', () => {
  const retry = () => undefined;
  expect(impactRetry({ status: 'failed', refused: false, retry })).toEqual({
    text: 'What this affects could not be read, so the delete is held.',
    label: 'Read again',
    run: retry,
  });
  expect(impactRetry({ status: 'loading' })).toBeNull();
});
