import { type Area } from '#/features/shell/services/areas';

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

// A shortcut is paused while a dialog is open, the unsaved-changes guard's
// own included.
export function dialogOpen(openDialogs: number, guardAsking: boolean): boolean {
  return openDialogs > 0 || guardAsking;
}

export function pathnameOf(href: string, base: string): string {
  return new URL(href, base).pathname;
}
