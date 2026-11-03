import type { Crumb } from '#/shared/services/breadcrumb';
import {
  ADD_SYSTEM_ADMIN_TITLE,
  CREATE_TENANT_TITLE,
} from '#/pages/tenants/services/creationPosition';
import {
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
} from '#/pages/tenants/services/systemTrail';
import { useAdministratorTitle } from '#/pages/tenants/use-cases/useAdministratorTitle';

export interface CreationGate {
  title: string;
  breadcrumb: readonly Crumb[];
}

export function useCreateTenantGate(): CreationGate {
  return { title: CREATE_TENANT_TITLE, breadcrumb: tenantsTrail(CREATE_TENANT_TITLE) };
}

// system's own administrators are added under System administrators, so the
// page keeps that area's name and trail while access is checked.
export function useAddSystemAdministratorGate(): CreationGate {
  return {
    title: ADD_SYSTEM_ADMIN_TITLE,
    breadcrumb: systemAdminsTrail(ADD_SYSTEM_ADMIN_TITLE),
  };
}

export function useAddAdministratorGate(name: string): CreationGate {
  return { title: useAdministratorTitle(name), breadcrumb: tenantAdministratorTrail(name) };
}
