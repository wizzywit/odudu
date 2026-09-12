import { describe, expect, it } from 'vitest';
import { isEmailAddress } from '#/service/email';

describe('[ODUDU-EMAIL-01] a stored email address is one an `email` claim may carry', () => {
  it.each([
    'alice@example.com',
    'alice.smith@example.com',
    "o'brien@example.com",
    'a+tag@example.co.uk',
    "!#$%&'*+-/=?^_`{|}~@example.com",
    'a@b.co',
    'x@sub.domain.example.museum',
    'user@my-host.example.com',
  ])('accepts %s', (address) => {
    expect(isEmailAddress(address)).toBe(true);
  });

  it.each([
    ['no at sign', 'alice.example.com'],
    ['two at signs', 'alice@example@com'],
    ['an empty local part', '@example.com'],
    ['an empty domain', 'alice@'],
    ['a leading dot in the local part', '.alice@example.com'],
    ['a trailing dot in the local part', 'alice.@example.com'],
    ['consecutive dots in the local part', 'al..ice@example.com'],
    ['a space', 'alice smith@example.com'],
    ['a leading space', ' alice@example.com'],
    ['a trailing newline', 'alice@example.com\n'],
    ['an empty domain label', 'alice@example..com'],
    ['a leading hyphen in a domain label', 'alice@-example.com'],
    ['a trailing hyphen in a domain label', 'alice@example-.com'],
    ['an underscore in the domain', 'alice@exa_mple.com'],
    ['nothing at all', ''],
  ])('rejects %s', (_case, address) => {
    expect(isEmailAddress(address)).toBe(false);
  });

  // The rule is deliberately a subset of addr-spec: everything it accepts is
  // a valid addr-spec, and these valid addr-specs are refused rather than
  // matched by a regex that would get them subtly wrong. See email.ts.
  it.each([
    ['a quoted local part', '"alice smith"@example.com'],
    ['a comment', 'alice(work)@example.com'],
    ['a domain literal', 'alice@[192.0.2.1]'],
    ['a single-label domain', 'alice@localhost'],
  ])('refuses %s, which addr-spec itself allows', (_case, address) => {
    expect(isEmailAddress(address)).toBe(false);
  });

  // RFC 5321 §4.5.3.1's octet limits, which an addr-spec that is going to
  // be delivered to has to respect as well.
  it('rejects a local part over 64 characters', () => {
    expect(isEmailAddress(`${'a'.repeat(65)}@example.com`)).toBe(false);
    expect(isEmailAddress(`${'a'.repeat(64)}@example.com`)).toBe(true);
  });

  it('rejects an address over 254 characters', () => {
    const domain = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.example.com`;
    expect(isEmailAddress(`${'a'.repeat(64)}@${domain}`)).toBe(false);
  });
});
