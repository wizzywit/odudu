import { checkMountPath, DEFAULT_COOKIE_NAME, isLocalPath } from '@odudu-io/bff/shared';
import { returnCookieName } from '#/services/return-cookie';
import type { OduduHandlersOptions, WithAuthOptions } from '#/types';

export const DEFAULT_MOUNT_PATH = '/api/auth';

export interface HandlersConfig {
  mountPath: string;
  proxyPath: string;
  cookieName: string;
  returnCookieName: string;
}

// A path of this origin and nothing else: no scheme, no host, no `//host`.
export function checkLocalPath(path: string, name: string): string {
  if (!isLocalPath(path)) {
    throw new TypeError(`${name} must be a path on this origin`);
  }
  return path;
}

export function resolveConfig(options: OduduHandlersOptions): HandlersConfig {
  const mountPath = checkMountPath(options.mountPath ?? DEFAULT_MOUNT_PATH);
  const cookieName = options.cookieName ?? DEFAULT_COOKIE_NAME;
  return {
    mountPath,
    proxyPath: options.proxyPath ?? `${mountPath}/proxy`,
    cookieName,
    returnCookieName: returnCookieName(cookieName),
  };
}

export interface AuthConfig {
  mountPath: string;
  loginPath: string;
  cookieName: string;
}

export function resolveAuthConfig(options: WithAuthOptions): AuthConfig {
  const mountPath = checkMountPath(options.mountPath ?? DEFAULT_MOUNT_PATH);
  return {
    mountPath,
    loginPath: checkLocalPath(options.loginPath ?? `${mountPath}/login`, 'loginPath'),
    cookieName: options.cookieName ?? DEFAULT_COOKIE_NAME,
  };
}
