export function signInLabel(enters: boolean, tenant: string): string {
  if (!enters) return 'Continue to sign-in';
  return tenant === '' ? 'Enter tenant' : `Enter ${tenant}`;
}

export function enteredTenant(typed: string): string {
  return typed.trim();
}
