import { expect, it } from 'vitest';
import type { Domain } from '#/pages/domains/types/domain';
import {
  askingOf,
  dialogOf,
  holdsSwitch,
  ifMatchOf,
  impactTarget,
  warningFor,
} from '#/pages/domains/services/confirm';

const verified: Domain = {
  id: 'd1',
  host: 'login.acme.com',
  state: 'verified',
  canonical: false,
  verified_at: null,
  last_checked_at: null,
  dns_record: null,
};

const ACK = {
  kind: 'acknowledge',
  text: '3 subjects hold passkeys registered at the other address.',
  label: 'I understand',
  note: 'They come back on a switch back.',
} as const;

it('asks a passkey impact for the host being made the address, and for the path on a switch back', () => {
  expect(impactTarget({ action: 'activate', domain: verified })).toBe('login.acme.com');
  expect(impactTarget({ action: 'deactivate', domain: verified })).toBe('path');
  expect(impactTarget({ action: 'remove', domain: verified })).toBeNull();
  expect(impactTarget(null)).toBeNull();
});

it('says what an activation changes: sign-ins end, the window, and the passkeys', () => {
  const dialog = dialogOf({ action: 'activate', domain: verified }, ACK);
  expect(dialog.title).toBe('Make login.acme.com the tenant’s address?');
  expect(dialog.consequence).toContain('signed out');
  expect(dialog.consequence).toContain('1 hour');
  expect(dialog.consequence).toContain('3 subjects hold passkeys');
  expect(dialog.confirmLabel).toBe('Make it the address');
  expect(dialog.tone).toBe('primary');
  expect(dialog.choice).toEqual({
    label: 'I understand',
    note: 'They come back on a switch back.',
  });
});

it('offers no choice when there is nothing to acknowledge', () => {
  const dialog = dialogOf({ action: 'activate', domain: verified }, { kind: 'none' });
  expect(dialog.choice).toBeUndefined();
});

it('says a count is being read while it is', () => {
  const dialog = dialogOf(
    { action: 'activate', domain: verified },
    { kind: 'counting', text: 'Counting…' },
  );
  expect(dialog.consequence).toContain('Counting…');
});

it('says a switch back returns the path address and that it is always possible', () => {
  const dialog = dialogOf({ action: 'deactivate', domain: verified }, { kind: 'none' });
  expect(dialog.title).toBe('Switch back to the path address?');
  expect(dialog.confirmLabel).toBe('Switch back');
  expect(dialog.consequence).toContain('path address');
});

it('says a removal drops the record and is a danger', () => {
  const dialog = dialogOf({ action: 'remove', domain: verified }, { kind: 'none' });
  expect(dialog.title).toBe('Remove login.acme.com?');
  expect(dialog.tone).toBe('danger');
  expect(dialog.confirmLabel).toBe('Remove domain');
});

it('warns of passkeys only for a switch, never for a removal', () => {
  const loading = { status: 'loading' } as const;
  expect(warningFor({ action: 'remove', domain: verified }, loading)).toEqual({ kind: 'none' });
  expect(warningFor(null, loading)).toEqual({ kind: 'none' });
  expect(warningFor({ action: 'activate', domain: verified }, loading).kind).toBe('counting');
});

it('holds a switch until it is allowed, and holds nothing when nothing is asked', () => {
  const asked = { action: 'activate', domain: verified } as const;
  expect(holdsSwitch(null, ACK, false)).toBe(false);
  expect(holdsSwitch(asked, ACK, false)).toBe(true);
  expect(holdsSwitch(asked, ACK, true)).toBe(false);
});

it('puts the dialog beside what was asked, and nothing beside nothing', () => {
  expect(askingOf(null, ACK)).toBeNull();
  expect(askingOf({ action: 'remove', domain: verified }, { kind: 'none' })?.dialog.title).toBe(
    'Remove login.acme.com?',
  );
});

it('sends no tag before the domains were read', () => {
  expect(ifMatchOf('"a"')).toBe('"a"');
  expect(ifMatchOf(null)).toBe('');
});
