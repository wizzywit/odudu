export type NoticeRecipient =
  | { readonly send: true; readonly to: string }
  | { readonly send: false; readonly reason: 'unverified' | 'none' };

// A notice about a change the person made goes only to an address they have
// proved: one nobody verified can belong to a stranger who registered with it,
// and the notice tells whoever reads it that an account exists and changed.
export function noticeRecipient(address: string | null, verified: boolean): NoticeRecipient {
  if (address === null || address === '') return { send: false, reason: 'none' };
  return verified ? { send: true, to: address } : { send: false, reason: 'unverified' };
}

export interface NoticeAddress {
  readonly email: string | null;
  readonly verified: boolean;
  readonly locale: string | null;
}

export function noticeAddressOf(
  user: {
    readonly email: string | null;
    readonly emailVerified: boolean;
    readonly locale: string | null;
  } | null,
): NoticeAddress {
  if (user === null) return { email: null, verified: false, locale: null };
  return { email: user.email, verified: user.emailVerified, locale: user.locale };
}
