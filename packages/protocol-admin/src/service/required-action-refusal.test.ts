import { describe, expect, it } from 'vitest';
import { requiredActionRefusal } from '#/service/required-action-refusal';

const READY = { hasEmail: true, termsConfigured: true, editableProfileFields: 20 };

describe('requiredActionRefusal', () => {
  it('asks nothing of a list that needs nothing', () => {
    expect(requiredActionRefusal(['update-password', 'configure-totp'], {})).toBeNull();
  });

  it('refuses verify-email for a subject with no address to verify', () => {
    expect(requiredActionRefusal(['verify-email'], { ...READY, hasEmail: false })).toBe('no_email');
    expect(requiredActionRefusal(['verify-email'], READY)).toBeNull();
  });

  it('refuses update-profile where a person may edit no profile field', () => {
    expect(requiredActionRefusal(['update-profile'], { ...READY, editableProfileFields: 0 })).toBe(
      'no_editable_profile_fields',
    );
    expect(requiredActionRefusal(['update-profile'], READY)).toBeNull();
  });

  it('refuses accept-terms where the tenant has no terms', () => {
    expect(requiredActionRefusal(['accept-terms'], { ...READY, termsConfigured: false })).toBe(
      'terms_not_configured',
    );
    expect(requiredActionRefusal(['accept-terms'], READY)).toBeNull();
  });

  it('judges only what the list names', () => {
    expect(
      requiredActionRefusal(['update-password'], {
        hasEmail: false,
        termsConfigured: false,
        editableProfileFields: 0,
      }),
    ).toBeNull();
  });

  it('names the first refusal in the order a sign-in asks', () => {
    expect(
      requiredActionRefusal(['accept-terms', 'verify-email'], {
        hasEmail: false,
        termsConfigured: false,
        editableProfileFields: 20,
      }),
    ).toBe('no_email');
  });
});
