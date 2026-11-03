import type { Crumb } from '#/shared/lib/services/breadcrumb';
import type { Creation, CreationFlow } from '#/entities/creation-draft';
import { administratorTitle } from '#/pages/tenants/services/administratorOrigin';
import { systemAdminsHrefOf } from '#/pages/tenants/services/systemAddress';
import {
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
} from '#/pages/tenants/services/systemTrail';

export const IMPORT_TITLE = 'Import a tenant';

export const CREATE_TENANT_TITLE = 'Create a tenant';

export const ADD_SYSTEM_ADMIN_TITLE = 'Add a system administrator';

export type CreationPage =
  | { step: 'tenant' }
  | {
      step: 'administrator';
      tenant: string;
      origin: 'created' | 'imported' | 'existing';
      systemAdminsHref: string | null;
    }
  | { step: 'done'; tenant: string; systemAdminsHref: string | null };

export function pageOf(creation: Creation): CreationPage {
  if (creation.step === 'tenant') return { step: 'tenant' };
  const systemAdminsHref = systemAdminsHrefOf(creation.tenant);
  return creation.step === 'done'
    ? { step: 'done', tenant: creation.tenant, systemAdminsHref }
    : { step: 'administrator', tenant: creation.tenant, origin: creation.origin, systemAdminsHref };
}

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
