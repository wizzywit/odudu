import { describe, expect, it } from 'vitest';
import { noticeRecipient } from '#/service/notice-recipient';

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
