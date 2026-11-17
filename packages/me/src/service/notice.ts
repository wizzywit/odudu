// What the owner is told after a change made through the me API; the same
// shapes the mail package renders.
export type OwnChange =
  | { readonly kind: 'totp_removed'; readonly codes: boolean }
  | { readonly kind: 'passkey_removed' }
  | { readonly kind: 'address_change_requested' };

// What an audit row records as `notice`.
export type NoticeOutcome = 'sent' | 'skipped_unverified' | 'skipped_none';

// `codes` is whether the recovery codes went with an authenticator app, which
// they do when it was the last one.
export function removalNotice(type: string, codesRevoked: number): OwnChange {
  return type === 'webauthn'
    ? { kind: 'passkey_removed' }
    : { kind: 'totp_removed', codes: codesRevoked > 0 };
}
