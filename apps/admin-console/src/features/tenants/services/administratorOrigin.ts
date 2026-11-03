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

const ORIGIN_TEXT: Readonly<Record<'created' | 'imported' | 'existing', string>> = {
  created: 'was created. It has no administrator yet, so nobody can sign in to its console.',
  imported:
    'was imported. An import creates no administrator, so nobody can sign in to its console yet.',
  existing: 'gets another administrator.',
};

// What the administrator step says of the tenant, after its name.
export function originText(origin: 'created' | 'imported' | 'existing'): string {
  return ORIGIN_TEXT[origin];
}

// A first administrator is given Full, so the page says so; a further one is chosen.
export function firstAdministratorNote(
  origin: 'created' | 'imported' | 'existing',
  tenant: string,
): string | null {
  return origin === 'existing'
    ? null
    : `The first administrator holds Full, so somebody in ${tenant} can give every capability; narrow it afterwards under Administrators.`;
}
