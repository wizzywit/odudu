import type { Auth, LogoutResult } from '#/shared/transport/auth';

export function logOut(auth: Auth): Promise<LogoutResult> {
  return auth.logout();
}
