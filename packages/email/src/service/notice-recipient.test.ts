import { describe, expect, it } from 'vitest';
import { noticeAddressOf, noticeRecipient } from '#/service/notice-recipient';

describe('noticeRecipient', () => {
  it('sends to a verified address', () => {
    expect(noticeRecipient('ada@example.test', true)).toEqual({
      send: true,
      to: 'ada@example.test',
    });
  });

  it('sends nothing to an address nobody has proved', () => {
    expect(noticeRecipient('ada@example.test', false)).toEqual({
      send: false,
      reason: 'unverified',
    });
  });

  it('says there is nobody to tell when there is no address', () => {
    expect(noticeRecipient(null, false)).toEqual({ send: false, reason: 'none' });
    expect(noticeRecipient(null, true)).toEqual({ send: false, reason: 'none' });
  });

  it('treats an empty address as none', () => {
    expect(noticeRecipient('', true)).toEqual({ send: false, reason: 'none' });
  });
});

describe('noticeAddressOf', () => {
  it('reads the address, its proof and the language from a subject row', () => {
    expect(
      noticeAddressOf({ email: 'ada@example.test', emailVerified: true, locale: 'ar' }),
    ).toEqual({ email: 'ada@example.test', verified: true, locale: 'ar' });
  });

  it('is an address nobody holds when the subject is not there', () => {
    expect(noticeAddressOf(null)).toEqual({ email: null, verified: false, locale: null });
  });
});
