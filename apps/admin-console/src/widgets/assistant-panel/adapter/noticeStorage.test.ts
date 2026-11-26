import { afterEach, expect, it, vi } from 'vitest';
import { noticeWasRead, rememberNoticeRead } from '#/widgets/assistant-panel/adapter/noticeStorage';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it('remembers that the notice was read', () => {
  expect(noticeWasRead()).toBe(false);
  rememberNoticeRead();
  expect(noticeWasRead()).toBe(true);
});

it('says it was not read when the browser refuses to say, and does not throw on a write', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(noticeWasRead()).toBe(false);
  expect(() => {
    rememberNoticeRead();
  }).not.toThrow();
});
