import { describe, expect, it } from 'vitest';
import {
  describeOtp,
  hasOtpStep,
  otpReading,
  otpRequired,
  readingOf,
} from '#/features/flow/services/otp';

describe('otpRequired', () => {
  it('reads the flag from the settings, false when it is not a boolean', () => {
    expect(otpRequired({ otp_required: true })).toBe(true);
    expect(otpRequired({ otp_required: false })).toBe(false);
    expect(otpRequired({ other: true })).toBe(false);
  });
});

describe('otpReading', () => {
  it('says whom the step asks', () => {
    expect(otpReading(true)).toMatch(/every subject/u);
    expect(otpReading(false)).toMatch(/only/u);
  });
});

describe('hasOtpStep', () => {
  it('finds the step by its authenticator, enabled or not', () => {
    expect(hasOtpStep([{ authenticator: 'otp', requirement: 'disabled' }])).toBe(true);
    expect(hasOtpStep([{ authenticator: 'password', requirement: 'required' }])).toBe(false);
  });
});

describe('describeOtp', () => {
  it('shows the flag as whom it asks, for a conflict', () => {
    expect(describeOtp(true)).toBe('asked of every subject');
    expect(describeOtp(false)).toBe('asked of those who set one up');
  });
});

describe('readingOf', () => {
  it('says whom the step asks once the settings are read, and nothing before', () => {
    expect(readingOf({ otp_required: true })).toBe('Asked of every subject.');
    expect(readingOf(undefined)).toBeNull();
  });
});
