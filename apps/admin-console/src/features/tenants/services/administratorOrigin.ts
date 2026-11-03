import type { Creation } from '#/features/tenants/services/creation';

export function titleOrigin(stored: Creation | null): 'created' | 'imported' | 'existing' {
  return stored?.step === 'administrator' ? stored.origin : 'existing';
}

// A created or imported tenant has no administrator yet, so this is its first.
export function administratorTitle(
  name: string,
  origin: 'created' | 'imported' | 'existing',
): string {
  return origin === 'existing'
    ? `Add an administrator to ${name}`
    : `First administrator of ${name}`;
}
