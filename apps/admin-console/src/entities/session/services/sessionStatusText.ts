import { tenantPage } from '#/shared/lib/services/address';
import type { Principal } from '#/entities/session/types/principal';

export function signingInTitle(ended: boolean): string {
  return ended ? 'Your session ended' : 'Signing in';
}

export function signingInText(tenant: string | null): string {
  return tenant === null ? 'Opening the console…' : `Taking you to ${tenant}'s sign-in…`;
}

export function signedInToTitle(tenant: string): string {
  return `Signed in to ${tenant}`;
}

export function backToLabel(tenant: string): string {
  return `Back to ${tenant}`;
}

export function signInAgainLabel(was: Principal): string {
  return `Sign in as ${was.username} again`;
}

export function continueAsLabel(now: Principal): string {
  return `Continue as ${now.username}`;
}

export interface SigningInWords {
  title: string;
  text: string;
}

export function signingInWords(tenant: string | null, ended: boolean): SigningInWords {
  return { title: signingInTitle(ended), text: signingInText(tenant) };
}

export interface SignedInElsewhereWords {
  title: string;
  backLabel: string;
  backHref: string;
  signInLabel: string;
}

export function signedInElsewhereWords(signedInTo: string, tenant: string): SignedInElsewhereWords {
  return {
    title: signedInToTitle(signedInTo),
    backLabel: backToLabel(signedInTo),
    backHref: tenantPage(signedInTo),
    signInLabel: signInToLabel(tenant),
  };
}

export function signInToLabel(tenant: string): string {
  return `Sign in to ${tenant}`;
}
