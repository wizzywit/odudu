import { describe, expect, it } from 'vitest';
import { ar, en } from '#/service/messages';
import { renderResetCompleted } from '#/service/templates';

const NOW = new Date('2026-11-12T09:05:00Z');
const input = { to: 'ada@example.test', tenantDisplayName: 'Demo', now: NOW };

describe('renderResetCompleted', () => {
  it('says the password was reset, when, and what to do if it was not them', () => {
    const msg = renderResetCompleted(input);
    expect(msg.to).toBe('ada@example.test');
    expect(msg.subject).toBe('Your password was reset for your Demo account');
    expect(msg.text).toContain('was reset using a mailed link.');
    expect(msg.text).toContain('2026-11-12 09:05 UTC');
    expect(msg.text).toContain(en['own.notYou']);
    expect(msg.html).toContain('Your password was reset');
    expect(msg.html).toContain(en['own.notYou']);
  });

  it('carries no link, no code and no secret', () => {
    const msg = renderResetCompleted(input);
    expect(msg.text + msg.html).not.toMatch(/https?:|<a |[0-9A-Z]{5}-[0-9A-Z]{5}/u);
  });

  it('is worded in Arabic, right to left, with every resetCompleted.* sentence translated', () => {
    for (const key of Object.keys(en).filter((id) => id.startsWith('resetCompleted.'))) {
      expect(Object.hasOwn(ar, key), key).toBe(true);
    }
    const msg = renderResetCompleted({ ...input, locale: 'ar' });
    expect(msg.html).toContain('dir="rtl"');
    expect(msg.text).toContain(ar['own.notYou']);
    expect(msg.subject).toContain('Demo');
  });
});
