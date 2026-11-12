import { describe, expect, it } from 'vitest';
import { createdDetail, redactedDiff } from '#/service/audit-detail';

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

  it('names the registration policy and the client metadata switch of tenant settings by value', () => {
    expect(
      redactedDiff(
        'tenant_settings',
        { client_registration_policy: 'disabled', cimd_enabled: false, verify_email: false },
        { client_registration_policy: 'mcp', cimd_enabled: true, verify_email: true },
      ),
    ).toEqual({
      client_registration_policy: { before: 'disabled', after: 'mcp' },
      cimd_enabled: { before: false, after: true },
    });
  });
});

describe('the wording settings of a tenant', () => {
  it('shows the display name and the languages by value, before and after, and no other setting', () => {
    expect(
      redactedDiff(
        'tenant_settings',
        {
          display_name: null,
          supported_locales: ['en'],
          default_locale: null,
          otp_required: false,
          registration_allowed: false,
        },
        {
          display_name: 'Acme',
          supported_locales: ['en', 'de'],
          default_locale: 'de',
          otp_required: true,
          registration_allowed: true,
        },
      ),
    ).toEqual({
      display_name: { before: null, after: 'Acme' },
      supported_locales: { before: ['en'], after: ['en', 'de'] },
      default_locale: { before: null, after: 'de' },
    });
  });
});

describe('createdDetail', () => {
  const role = { id: 'r1', name: 'auditors', description: null, default_for_new_subjects: false };

  it('records the fields a create set, with what they became and no earlier value', () => {
    expect(createdDetail('role', { ...role, description: 'Reads the audit trail' })).toEqual({
      name: { after: 'auditors' },
      description: { after: 'Reads the audit trail' },
    });
  });

  it('leaves out a field that holds what an empty row holds, so a create names what it chose', () => {
    expect(createdDetail('role', role)).toEqual({ name: { after: 'auditors' } });
    expect(
      createdDetail('group', {
        name: 'staff',
        description: null,
        parent_id: null,
        default_for_new_subjects: false,
      }),
    ).toEqual({ name: { after: 'staff' } });
  });

  it('records a field that is not at its default, whoever set it', () => {
    expect(createdDetail('role', { ...role, default_for_new_subjects: true })).toEqual({
      name: { after: 'auditors' },
      default_for_new_subjects: { after: true },
    });
    expect(createdDetail('group', { name: 'staff', parent_id: 'p1' })).toEqual({
      name: { after: 'staff' },
      parent_id: { after: 'p1' },
    });
  });

  it('holds a scope to its own defaults, a language text and the display order included', () => {
    const scope = {
      name: 'orders',
      description: null,
      include_in_id_token: true,
      include_in_access_token: true,
      default_client_assignment: null,
      consent_text: null,
      description_i18n: {},
      consent_text_i18n: {},
      display_order: 0,
    };
    expect(createdDetail('scope', scope)).toEqual({ name: { after: 'orders' } });
    expect(
      createdDetail('scope', {
        ...scope,
        description_i18n: { de: 'Bestellungen' },
        display_order: 4,
        include_in_id_token: false,
      }),
    ).toEqual({
      name: { after: 'orders' },
      description_i18n: { after: { de: 'Bestellungen' } },
      display_order: { after: 4 },
      include_in_id_token: { after: false },
    });
  });

  it('records the client a role belongs to, and leaves a tenant role without one unnamed', () => {
    expect(createdDetail('role', { ...role, client_id: null })).toEqual({
      name: { after: 'auditors' },
    });
    expect(createdDetail('role', { ...role, client_id: 'c1' })).toEqual({
      name: { after: 'auditors' },
      client_id: { after: 'c1' },
    });
  });

  it('never records a field the allowlist does not name', () => {
    expect(createdDetail('role', { ...role, created_at: 'x', admin_reach: ['a'] })).toEqual({
      name: { after: 'auditors' },
    });
  });
});

describe('the passkey switch', () => {
  it('shows the switch by value, so a tenant-wide mandate is on the trail', () => {
    expect(
      redactedDiff(
        'tenant_settings',
        { require_passkey: false, verify_email: false },
        { require_passkey: true, verify_email: true },
      ),
    ).toEqual({ require_passkey: { before: false, after: true } });
  });
});
