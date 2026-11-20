import { requestLogout, requestProxy, requestSession } from '#/adapter/bff';
import { signedOut } from '#/services/auth-state';
import { redirectOf, sessionStateOf } from '#/services/bff';
import { logoutRefused } from '#/services/errors';
import type { AuthState } from '#/types';

// One request: the BFF answers 401 once the session is over.
export async function readSession(baseUrl: string): Promise<AuthState> {
  const response = await requestSession(baseUrl);
  return response.ok ? sessionStateOf(await response.json()) : signedOut();
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
  init?: RequestInit,
): Promise<Response> {
  return requestProxy(baseUrl, path, init);
}
