import { requestLogout, requestProxy, requestSession } from '#/adapter/bff';
import { signedOut } from '#/services/auth-state';
import { redirectOf, sessionStateOf } from '#/services/bff';
import { logoutRefused, sessionCheckFailed } from '#/services/errors';
import type { AuthState } from '#/types';

// One request. Only a 401, which the BFF answers once the session is over, is a
// person who is signed out; any other status is a failed check.
export async function readSession(baseUrl: string): Promise<AuthState> {
  const response = await requestSession(baseUrl);
  if (response.ok) return sessionStateOf(await response.json());
  return signedOut(response.status === 401 ? undefined : sessionCheckFailed(response.status));
}

// The address that ends the session at the issuer, when the BFF has one.
export async function endSession(baseUrl: string): Promise<string | undefined> {
  const response = await requestLogout(baseUrl);
  if (response.status === 204) return undefined;
  if (!response.ok) throw logoutRefused(response.status);
  return redirectOf(await response.json());
}

export function callThroughProxy(
  baseUrl: string,
  path: string,
  proxyPath: string | undefined,
  init?: RequestInit,
): Promise<Response> {
  return requestProxy(baseUrl, path, proxyPath, init);
}
