import { describe, expect, it } from 'vitest';
import {
  isValidBirthdate,
  isValidLocale,
  isValidProfileUrl,
  isValidZoneinfo,
} from '#/service/profile';

describe('birthdate', () => {
  it.each([['1990-01-31'], ['1990'], ['0000']])('accepts %s', (v) => {
    expect(isValidBirthdate(v)).toBe(true);
  });
  it.each([['90-01-31'], ['1990-1-1'], ['31/01/1990'], ['']])('refuses %s', (v) => {
    expect(isValidBirthdate(v)).toBe(false);
  });
});

describe('zoneinfo', () => {
  it.each([['UTC'], ['America/New_York'], ['Asia/Ho_Chi_Minh']])('accepts %s', (v) => {
    expect(isValidZoneinfo(v)).toBe(true);
  });
  it.each([['+1'], ['/America'], ['']])('refuses %s', (v) => {
    expect(isValidZoneinfo(v)).toBe(false);
  });
});

describe('locale', () => {
  it.each([['en'], ['en-US'], ['zh-Hans-CN']])('accepts %s', (v) => {
    expect(isValidLocale(v)).toBe(true);
  });
  it.each([['english'], ['en_US'], ['']])('refuses %s', (v) => {
    expect(isValidLocale(v)).toBe(false);
  });
});

describe('profile URLs', () => {
  it.each([['https://example.com/alice'], ['http://example.com/alice.png']])('accepts %s', (v) => {
    expect(isValidProfileUrl(v)).toBe(true);
  });
  it.each([['javascript:alert(1)'], ['ftp://example.com'], ['']])('refuses %s', (v) => {
    expect(isValidProfileUrl(v)).toBe(false);
  });
});
