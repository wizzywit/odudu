import type { Auth, LogoutResult } from '#/shared/api/transport/auth';

export function logOut(auth: Auth): Promise<LogoutResult> {
  return auth.logout();
}
