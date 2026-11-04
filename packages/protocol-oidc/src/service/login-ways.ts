import { MAX_SIGN_IN_PATH_LENGTH, addressPath, type TenantAddress } from '@odudu/kernel';

// The pages the sign-in form offers beside itself, as paths on this server.
// Each is offered only while the tenant serves it: those pages answer 404 on
// the same two settings. `signInPath` is the authorize path rebuilt from the
// parked request, so the page the person goes to can bring them back to it.
export interface LoginWays {
  createAccount?: string;
  resetPassword?: string;
}

export interface LoginWaySettings {
  registrationAllowed: boolean;
  resetPasswordAllowed: boolean;
}

export type AccountPage = 'registration' | 'reset-password';

// One of the account pages, carrying the way back to the sign-in. The same
// path whether the person follows the sign-in form's link or the client
// asked for the page outright with prompt=create.
export function accountPagePath(
  address: TenantAddress,
  page: AccountPage,
  signInPath: string | null,
): string {
  // A path past the bound the receiving page accepts would be dropped there
  // and lose the request anyway, so it is not sent: the links still work, and
  // the person signs in again from the application.
  const carried =
    signInPath !== null && signInPath.length <= MAX_SIGN_IN_PATH_LENGTH ? signInPath : null;
  const query =
    carried === null ? '' : `?${new URLSearchParams({ return_to: carried }).toString()}`;
  return addressPath(address, `/login-actions/${page}${query}`);
}

export function loginWays(
  address: TenantAddress,
  settings: LoginWaySettings,
  signInPath: string | null,
): LoginWays {
  return {
    ...(settings.registrationAllowed
      ? { createAccount: accountPagePath(address, 'registration', signInPath) }
      : {}),
    ...(settings.resetPasswordAllowed
      ? { resetPassword: accountPagePath(address, 'reset-password', signInPath) }
      : {}),
  };
}
