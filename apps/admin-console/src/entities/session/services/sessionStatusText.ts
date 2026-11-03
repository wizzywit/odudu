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

export function signInToLabel(tenant: string): string {
  return `Sign in to ${tenant}`;
}
