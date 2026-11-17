import { describe, expect, it } from 'vitest';
import { removalNotice } from '#/service/notice';

describe('removalNotice', () => {
  it('names a passkey, with no word about codes', () => {
    expect(removalNotice('webauthn', 0)).toEqual({ kind: 'passkey_removed' });
    expect(removalNotice('webauthn', 10)).toEqual({ kind: 'passkey_removed' });
  });

  it('says the codes went with an authenticator app only when some were revoked', () => {
    expect(removalNotice('totp', 0)).toEqual({ kind: 'totp_removed', codes: false });
    expect(removalNotice('totp', 10)).toEqual({ kind: 'totp_removed', codes: true });
  });
});
