import { addressUrl, type TenantAddress } from '@odudu/kernel';

// The one place a mailed link to /login-actions/action-token is built, so the
// tenant is always one encoded path segment. The link carries the key and
// nothing of the sign-in it came out of: it sits in a mailbox, in a relay's
// logs and in a mail client's history, so the way back to that sign-in is
// kept on the server, beside the token (sign-in-resume.ts).
export function actionLink(address: TenantAddress, token: string): string {
  const base = addressUrl(address, '/login-actions/action-token');
  return `${base}?${new URLSearchParams({ key: token }).toString()}`;
}

// Where a person who forgot their password asks for a link.
export function resetPasswordLink(address: TenantAddress): string {
  return addressUrl(address, '/login-actions/reset-password');
}
