import type { Creation } from '#/features/tenants/services/creation';

export function titleOrigin(stored: Creation | null): 'created' | 'imported' | 'existing' {
  return stored?.step === 'administrator' ? stored.origin : 'existing';
}
