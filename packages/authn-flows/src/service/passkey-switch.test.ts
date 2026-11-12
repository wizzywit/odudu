import { describe, expect, it } from 'vitest';
import { passkeyCheckedAgainst } from '#/service/passkey-switch';

describe('passkeyCheckedAgainst', () => {
  it('names the relying party where the tenant asks for a passkey and one can be enrolled', () => {
    expect(passkeyCheckedAgainst({ required: true, relyingPartyId: 'id.example' })).toBe(
      'id.example',
    );
  });

  it('checks nothing with the switch off', () => {
    expect(passkeyCheckedAgainst({ required: false, relyingPartyId: 'id.example' })).toBeNull();
  });

  it('checks nothing where the deployment has no relying party, so nobody is owed a page that cannot be shown', () => {
    expect(passkeyCheckedAgainst({ required: true, relyingPartyId: null })).toBeNull();
  });
});
