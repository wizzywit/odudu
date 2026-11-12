import { describe, expect, it } from 'vitest';
import {
  addedActions,
  readsNeeded,
  requiredActionRefusal,
} from '#/service/required-action-refusal';

describe('requiredActionRefusal', () => {
  it('asks nothing of a list that needs nothing', () => {
    expect(requiredActionRefusal(['update-password', 'configure-totp'], {})).toBeNull();
  });

  it('refuses verify-email for a subject with no address to verify', () => {
    expect(requiredActionRefusal(['verify-email'], { email: null })).toBe('no_email');
    expect(requiredActionRefusal(['verify-email'], { email: 'ada@example.com' })).toBeNull();
  });

  it('refuses update-profile where a person may not edit a field it requires', () => {
    const sources = {
      requiredProfileFields: ['given_name', 'nope'],
      editableProfileFields: ['given_name'],
    };
    expect(requiredActionRefusal(['update-profile'], sources)).toBe('no_editable_profile_fields');
    expect(
      requiredActionRefusal(['update-profile'], {
        ...sources,
        requiredProfileFields: ['given_name'],
      }),
    ).toBeNull();
    expect(
      requiredActionRefusal(['update-profile'], { ...sources, requiredProfileFields: [] }),
    ).toBeNull();
  });

  it('refuses accept-terms where the tenant has no terms', () => {
    expect(requiredActionRefusal(['accept-terms'], { termsUri: null })).toBe(
      'terms_not_configured',
    );
    expect(
      requiredActionRefusal(['accept-terms'], { termsUri: 'https://example.com/t' }),
    ).toBeNull();
  });

  it('judges only what the list names', () => {
    expect(requiredActionRefusal(['update-password'], { email: null, termsUri: null })).toBeNull();
  });

  it('names the first refusal in the order a sign-in asks', () => {
    expect(
      requiredActionRefusal(['accept-terms', 'verify-email'], { email: null, termsUri: null }),
    ).toBe('no_email');
  });
});

describe('addedActions', () => {
  it('is what the request adds to what is owed, so a kept action is not judged again', () => {
    expect(
      addedActions(['accept-terms', 'update-password'], ['accept-terms', 'configure-totp']),
    ).toEqual(['configure-totp']);
    expect(addedActions([], [])).toEqual([]);
  });
});

describe('readsNeeded', () => {
  it('reads the subject for an address check and the tenant for terms or a profile', () => {
    expect(readsNeeded(['verify-email'])).toEqual({ user: true, tenant: false });
    expect(readsNeeded(['accept-terms'])).toEqual({ user: false, tenant: true });
    expect(readsNeeded(['update-profile', 'update-password'])).toEqual({
      user: false,
      tenant: true,
    });
    expect(readsNeeded(['update-password'])).toEqual({ user: false, tenant: false });
  });
});
