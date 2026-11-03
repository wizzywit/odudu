import type { Principal } from '#/entities/session';

export function signInLabel(enters: boolean, tenant: string): string {
  if (!enters) return 'Continue to sign-in';
  return tenant === '' ? 'Enter tenant' : `Enter ${tenant}`;
}

export function signInAgainLabel(was: Principal): string {
  return `Sign in as ${was.username} again`;
}

export function continueAsLabel(now: Principal): string {
  return `Continue as ${now.username}`;
}

export function enteredTenant(typed: string): string {
  return typed.trim();
}
