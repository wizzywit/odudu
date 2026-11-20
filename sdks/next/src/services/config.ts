import { returnCookieName } from '#/services/return-cookie';
import type { OduduHandlersOptions } from '#/types';

export const DEFAULT_COOKIE_NAME = '__Host-odudu';
const DEFAULT_MOUNT_PATH = '/api/auth';

export interface HandlersConfig {
  mountPath: string;
  proxyPath: string;
  cookieName: string;
  returnCookieName: string;
}

// A path of this origin the app can mount on as it stands: a slash, then only
// unreserved characters and slashes, and no trailing slash. Empty is the root.
export function checkMountPath(path: string): string {
  if (path === '') return path;
  if (!/^\/[A-Za-z0-9/_.~-]*$/u.test(path) || path.endsWith('/') || path.includes('//')) {
    throw new TypeError(
      'mountPath must start with / and not end with one, with only A-Z a-z 0-9 / _ . ~ - in it',
    );
  }
  return path;
}

// A path of this origin and nothing else: no scheme, no host, no `//host`.
export function checkLocalPath(path: string, name: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
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
