import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAIL_CHOICE,
  mailClientId,
  mailClientName,
  mailClientOf,
  mailClientSelection,
  mailChoiceWith,
  mailFrameKey,
} from '#/pages/branding/services/mailChoice';

describe('the frame a preview shows in', () => {
  it('reloads the frame when the theme is published or the choice changes', () => {
    const base = mailFrameKey(1, DEFAULT_MAIL_CHOICE);
    expect(mailFrameKey(2, DEFAULT_MAIL_CHOICE)).not.toBe(base);
    expect(mailFrameKey(1, mailChoiceWith(DEFAULT_MAIL_CHOICE, { scheme: 'dark' }))).not.toBe(base);
    expect(mailFrameKey(1, mailChoiceWith(DEFAULT_MAIL_CHOICE, { locale: 'ar' }))).not.toBe(base);
    expect(mailFrameKey(1, mailChoiceWith(DEFAULT_MAIL_CHOICE, { client: 'c1' }))).not.toBe(base);
  });
});

describe('the client a picker last chose', () => {
  it('takes the client a picker last chose from the options it holds', () => {
    const options = [
      { id: 'a', name: 'A', extra: 1 },
      { id: 'b', name: 'B', extra: 2 },
    ];
    expect(mailClientOf(options, ['a', 'b'])).toEqual({ id: 'b', name: 'B' });
    expect(mailClientOf(options, [])).toBeNull();
    expect(mailClientOf(options, ['gone'])).toBeNull();
  });
});

describe('what a chosen client means to the mail tab', () => {
  const billing = { id: 'c1', name: 'Billing' };

  it('is the tenant’s own with no client: no id, no name, nothing selected', () => {
    expect(mailClientId(null)).toBe('');
    expect(mailClientName(null)).toBeNull();
    expect(mailClientSelection(null)).toEqual([]);
  });

  it('is the client’s id, name and selection once one is chosen', () => {
    expect(mailClientId(billing)).toBe('c1');
    expect(mailClientName(billing)).toBe('Billing');
    expect(mailClientSelection(billing)).toEqual(['c1']);
  });
});
