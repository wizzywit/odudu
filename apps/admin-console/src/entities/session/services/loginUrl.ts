import { type SignOutAnswer } from '#/entities/session/services/boot';
import { returnPath } from '#/entities/session/services/returnPath';
import { CONSOLE_ROOT } from '#/shared/services/address';

export function loginUrl(tenant: string, returnTo: string): string {
  const query = new URLSearchParams({ tenant, return_to: returnPath(returnTo) });
  return `/console/auth/login?${query.toString()}`;
}

export const CHOOSE_TENANT = 'choose';

export const SWITCH_HREF = `/console/?${CHOOSE_TENANT}`;

export function signOutDestination(result: SignOutAnswer): string {
  return result.ok ? result.redirect : CONSOLE_ROOT;
}
