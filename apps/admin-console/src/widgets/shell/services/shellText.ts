import { type Area } from '#/entities/area';

export function brandText(tenant: string): string {
  return `odudu · ${tenant}`;
}

export function areasLabel(tenant: string): string {
  return `Areas of ${tenant}`;
}

// Whose session it is, when it was issued by another tenant.
export function signedInFrom(signedInTo: string, tenant: string): string | null {
  return signedInTo === tenant ? null : signedInTo;
}

export function checkingText(area: Area): string {
  return `Checking access to ${area.label}`;
}

export function tenantNotFoundText(tenant: string): string {
  return `No tenant is named ${tenant}.`;
}

export const SYSTEM_KICKER = 'System';

export function systemCheckingText(title: string): string {
  return `Checking access to ${title}`;
}
