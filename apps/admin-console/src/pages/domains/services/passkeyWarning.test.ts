import { expect, it } from 'vitest';
import { impactRead, passkeyWarning, switchAllowed } from '#/pages/domains/services/passkeyWarning';

const ready = (subjects: number, capped = false) =>
  ({ status: 'ready', data: { subjects, capped } }) as const;

it('holds the switch while the count is being read', () => {
  const warning = passkeyWarning({ status: 'loading' });
  expect(warning.kind).toBe('counting');
  expect(switchAllowed(warning, false)).toBe(false);
  expect(switchAllowed(warning, true)).toBe(false);
});

it('asks for nothing when no subject holds a passkey the switch would hide', () => {
  const warning = passkeyWarning(ready(0));
  expect(warning).toEqual({ kind: 'none' });
  expect(switchAllowed(warning, false)).toBe(true);
});

it('requires an acknowledgement, counted, when subjects would lose passkeys', () => {
  const warning = passkeyWarning(ready(1));
  expect(warning.kind).toBe('acknowledge');
  if (warning.kind !== 'acknowledge') return;
  expect(warning.text).toContain('1 subject holds a passkey');
  expect(warning.text).toContain('Password sign-in is not affected');
  expect(switchAllowed(warning, false)).toBe(false);
  expect(switchAllowed(warning, true)).toBe(true);
});

it('says at least, grouped, when the count was capped', () => {
  const warning = passkeyWarning(ready(10_000, true));
  if (warning.kind !== 'acknowledge') throw new Error('expected an acknowledgement');
  expect(warning.text).toContain('At least 10,000 subjects hold passkeys');
});

it('still requires an acknowledgement when the count could not be read', () => {
  const warning = passkeyWarning({ status: 'failed', refused: false, retry: () => undefined });
  if (warning.kind !== 'acknowledge') throw new Error('expected an acknowledgement');
  expect(warning.text).toContain('could not be counted');
  expect(switchAllowed(warning, false)).toBe(false);
  expect(switchAllowed(warning, true)).toBe(true);
});

it('reads as loading while a fresh count is fetched, whatever count was kept', () => {
  const kept = {
    ok: true,
    status: 200,
    data: { subjects: 0, capped: false },
    etag: null,
    next: null,
  } as const;
  expect(impactRead(true, kept, () => undefined)).toEqual({ status: 'loading' });
  expect(impactRead(false, kept, () => undefined).status).toBe('ready');
});
