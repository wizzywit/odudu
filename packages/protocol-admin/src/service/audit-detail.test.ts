import { describe, expect, it } from 'vitest';
import { redactedDiff } from '#/service/audit-detail';

describe('redactedDiff', () => {
  it('records only the fields that changed', () => {
    expect(
      redactedDiff('client', { name: 'a', enabled: true }, { name: 'b', enabled: true }),
    ).toEqual({ name: { before: 'a', after: 'b' } });
  });

  it('never records a secret, a hash or a key, even if it changed', () => {
    const before = {
      name: 'a',
      secret_hash: 'old-secret-value',
      password_encrypted: 'old-password-value',
      jwks: { k: 1 },
    };
    const after = {
      name: 'a',
      secret_hash: 'new-secret-value',
      password_encrypted: 'new-password-value',
      jwks: { k: 2 },
    };
    const diff = redactedDiff('client', before, after);
    const serialised = JSON.stringify(diff);
    expect(serialised).not.toContain('old-secret-value');
    expect(serialised).not.toContain('new-secret-value');
    expect(serialised).not.toContain('old-password-value');
    expect(serialised).not.toContain('new-password-value');
    expect(diff).toEqual({
      secret_hash: { changed: true },
      password_encrypted: { changed: true },
      jwks: { changed: true },
    });
  });

  it('is allowlist-driven, so a field added later is absent rather than leaked', () => {
    expect(redactedDiff('client', { brand_new: 'a' }, { brand_new: 'b' })).toEqual({});
  });

  it('omits every field for a resource type with no allowlist configured', () => {
    // Read as a change to make go red: giving 'widget' an ALLOWLISTS entry
    // with a 'value' field would put that field in the result.
    expect(redactedDiff('widget', { name: 'a' }, { name: 'b' })).toEqual({});
  });

  it('treats a non-object before as though nothing existed yet', () => {
    expect(redactedDiff('client', null, { name: 'a' })).toEqual({
      name: { before: undefined, after: 'a' },
    });
  });
});
