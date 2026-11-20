import { OduduError } from '#/services/odudu-error';
import type { SignInOptions } from '#/types';

const ME_READ = 'me:read';
const ME_WRITE = 'me:write';

export function meResource(issuer: string): string {
  return `${issuer.replace(/\/+$/u, '')}/me`;
}

export function refuseConflictingOptions(options: SignInOptions): void {
  // The type forbids both; a caller without the types can still send both.
  const { prompt, action } = options as { prompt?: string; action?: string };
  if (prompt !== undefined && action !== undefined) {
    throw new OduduError(
      'invalid_options',
      'prompt and action cannot be combined: a sign-in starts at one or the other',
    );
  }
}

// `openid` is always asked for: without it there is no ID token to check.
export function scopeOf(options: SignInOptions): string {
  const scopes = new Set(['openid', ...options.scope.split(/\s+/u).filter((s) => s !== '')]);
  if (options.meAccess !== undefined) scopes.add(ME_READ);
  if (options.meAccess === 'write') scopes.add(ME_WRITE);
  return [...scopes].join(' ');
}

export function resourcesOf(options: SignInOptions): string[] {
  const resources = new Set(options.resource ?? []);
  if (options.meAccess !== undefined) resources.add(meResource(options.issuer));
  return [...resources];
}
