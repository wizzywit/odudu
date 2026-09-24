import { type TenantCapability } from '@odudu/domain-tenant';

export interface AdminRoute {
  readonly method: string;
  readonly pattern: string;
  readonly capability: TenantCapability | null;
}

// The single list the router registers from (view/routes/router.ts): a
// route with no entry here fails at startup rather than shipping
// reachable and unguarded. `capability: null` means authentication
// alone — `whoami` is the only one.
export const ADMIN_ROUTES: readonly AdminRoute[] = [
  { method: 'GET', pattern: '/admin/tenants/:tenant/whoami', capability: null },
  { method: 'GET', pattern: '/admin/tenants/:tenant/subjects', capability: 'view-users' },
];

export function requiredCapability(
  method: string,
  pattern: string,
): TenantCapability | null | undefined {
  const route = ADMIN_ROUTES.find((r) => r.method === method && r.pattern === pattern);
  return route === undefined ? undefined : route.capability;
}
