import type { Auth, LogoutResult } from '#/shared/transport/auth.ts';

export function logOut(auth: Auth): Promise<LogoutResult> {
  return auth.logout();
}
