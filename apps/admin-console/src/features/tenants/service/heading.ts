import type { Crumb } from '#/shared/service/breadcrumb.ts';
import { type CreationFlow } from '#/features/tenants/service/creation.ts';
import {
  administratorTitle,
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
} from '#/features/tenants/service/address.ts';

export const CREATE_TENANT_TITLE = 'Create a tenant';

export const ADD_SYSTEM_ADMIN_TITLE = 'Add a system administrator';

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

export type CreationPage =
  | { step: 'tenant' }
  | {
      step: 'administrator';
      tenant: string;
      origin: 'created' | 'imported' | 'existing';
      systemAdminsHref: string | null;
    }
  | { step: 'done'; tenant: string; systemAdminsHref: string | null };

// Where the page is among the steps, what it is called, and the way back.
export function creationHeading(
  flow: CreationFlow,
  current: CreationPage,
): { at: number; title: string; breadcrumb: readonly Crumb[] } {
  const at = current.step === 'tenant' ? 0 : current.step === 'administrator' ? 1 : 2;
  if (current.step === 'tenant') {
    return {
      at,
      title: CREATE_TENANT_TITLE,
      breadcrumb: tenantsTrail(CREATE_TENANT_TITLE),
    };
  }
  if (current.systemAdminsHref !== null) {
    return {
      at,
      title: ADD_SYSTEM_ADMIN_TITLE,
      breadcrumb: systemAdminsTrail(ADD_SYSTEM_ADMIN_TITLE),
    };
  }
  const origin =
    flow === 'tenant' ? 'created' : current.step === 'done' ? 'existing' : current.origin;
  const title = administratorTitle(current.tenant, origin);
  return {
    at,
    title,
    breadcrumb: flow === 'tenant' ? tenantsTrail(title) : tenantAdministratorTrail(current.tenant),
  };
}
