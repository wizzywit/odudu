import type { CreationFlow } from '#/features/tenants/services/creation';

// Starting over from a tenant's own administrator adds another to it.
export function againOf(flow: CreationFlow): 'tenant' | 'administrator' {
  return flow === 'tenant' ? 'tenant' : 'administrator';
}
