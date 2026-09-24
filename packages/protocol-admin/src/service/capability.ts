import { type TenantCapability } from '@odudu/domain-tenant';
import { z } from 'zod';

export interface AdminRoute {
  readonly method: string;
  readonly pattern: string;
  readonly capability: TenantCapability | null;
  // The shape of a successful response, published at /admin/openapi.json.
  // Required, not optional: a route with no schema is a type error, not a
  // gap the document silently leaves out.
  readonly responseSchema: z.ZodType;
}

// The single list the router registers from (view/routes/router.ts): a
// route with no entry here fails at startup rather than shipping
// reachable and unguarded. `capability: null` means authentication
// alone — `whoami` is the only one.
export const ADMIN_ROUTES: readonly AdminRoute[] = [
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/whoami',
    capability: null,
    responseSchema: z.object({ subjectId: z.string(), issuerTenantId: z.string() }),
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects',
    capability: 'view-users',
    responseSchema: z.array(z.unknown()),
  },
];

export function requiredCapability(
  method: string,
  pattern: string,
): TenantCapability | null | undefined {
  const route = ADMIN_ROUTES.find((r) => r.method === method && r.pattern === pattern);
  return route === undefined ? undefined : route.capability;
}
