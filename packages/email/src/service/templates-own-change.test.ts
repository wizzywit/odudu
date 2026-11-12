import { describe, expect, it } from 'vitest';
import { ar, en } from '#/service/messages';
import { renderOwnChange, type OwnChange } from '#/service/templates';

const NOW = new Date('2026-11-12T09:05:00Z');
const input = { to: 'ada@example.test', tenantDisplayName: 'Demo', now: NOW };

const CHANGES: readonly OwnChange[] = [
  { kind: 'totp_added' },
  { kind: 'passkey_added' },
  { kind: 'totp_removed', codes: false },
  { kind: 'totp_removed', codes: true },
  { kind: 'passkey_removed' },
  { kind: 'recovery_set_issued' },
  { kind: 'address_change_requested' },
];

describe('renderOwnChange', () => {
  it.each(CHANGES)('says what changed, when, and what to do for %j', (change) => {
    const msg = renderOwnChange({ ...input, change });
    expect(msg.to).toBe('ada@example.test');
    expect(msg.text).toContain('Demo');
    expect(msg.text).toContain('2026-11-12 09:05 UTC');
    expect(msg.text).toContain(en['own.notYou']);
    expect(msg.html).toContain(en['own.notYou']);
  });

  it.each(CHANGES)('carries no link, no code and no secret for %j', (change) => {
    const msg = renderOwnChange({ ...input, change });
    expect(msg.text + msg.html).not.toMatch(/https?:|<a |[0-9A-Z]{5}-[0-9A-Z]{5}/u);
  });

  it('names the factor in the subject', () => {
    expect(renderOwnChange({ ...input, change: { kind: 'totp_added' } }).subject).toBe(
      'An authenticator app was added to your Demo account',
    );
    expect(renderOwnChange({ ...input, change: { kind: 'passkey_removed' } }).subject).toBe(
      'A passkey was removed from your Demo account',
    );
  });

  it('says the codes went with the last authenticator app, only when they did', () => {
    const with_ = renderOwnChange({ ...input, change: { kind: 'totp_removed', codes: true } });
    const without = renderOwnChange({ ...input, change: { kind: 'totp_removed', codes: false } });
    expect(with_.text).toContain(en['own.codesRemoved']);
    expect(without.text).not.toContain(en['own.codesRemoved']);
  });

  it('says an address change takes effect only when the new address is confirmed', () => {
    const msg = renderOwnChange({ ...input, change: { kind: 'address_change_requested' } });
    expect(msg.text).toContain('until');
  });

  it('is worded in Arabic, right to left, with every own.* sentence translated', () => {
    for (const key of Object.keys(en).filter((id) => id.startsWith('own.'))) {
      expect(Object.hasOwn(ar, key), key).toBe(true);
    }
    const msg = renderOwnChange({ ...input, change: { kind: 'totp_added' }, locale: 'ar' });
    expect(msg.html).toContain('dir="rtl"');
    expect(msg.text).toContain(ar['own.notYou']);
  });
});
