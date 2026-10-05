import { type Principal } from '#/shared/service/principal.ts';

export function signInLabel(enters: boolean, tenant: string): string {
  if (!enters) return 'Continue to sign-in';
  return tenant === '' ? 'Enter tenant' : `Enter ${tenant}`;
}

export function signingInTitle(ended: boolean): string {
  return ended ? 'Your session ended' : 'Signing in';
}

export function signingInText(tenant: string | null): string {
  return tenant === null ? 'Opening the console…' : `Taking you to ${tenant}'s sign-in…`;
}

export function signInAgainLabel(was: Principal): string {
  return `Sign in as ${was.username} again`;
}

export function continueAsLabel(now: Principal): string {
  return `Continue as ${now.username}`;
}

export function signedInToTitle(tenant: string): string {
  return `Signed in to ${tenant}`;
}

export function backToLabel(tenant: string): string {
  return `Back to ${tenant}`;
}

export function signInToLabel(tenant: string): string {
  return `Sign in to ${tenant}`;
}

export function enteredTenant(typed: string): string {
  return typed.trim();
}
