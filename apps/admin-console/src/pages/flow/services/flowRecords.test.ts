import { describe, expect, it } from 'vitest';
import { otpRead, settingsFailed } from '#/pages/flow/services/flowRecords';

describe('otpRead', () => {
  it('offers the section once the settings and their ETag are read', () => {
    expect(otpRead({ data: { otp_required: false }, etag: '"s1"', gone: false })).toEqual({
      data: { otp_required: false },
      etag: '"s1"',
      gone: false,
    });
  });

  it('offers nothing before they are read', () => {
    expect(otpRead({ data: undefined, etag: null, gone: false })).toBeNull();
    expect(otpRead({ data: {}, etag: null, gone: false })).toBeNull();
  });
});

it('says the settings failed only for the status failed', () => {
  expect(settingsFailed('failed')).toBe(true);
  expect(settingsFailed('loading')).toBe(false);
  expect(settingsFailed('ready')).toBe(false);
});
