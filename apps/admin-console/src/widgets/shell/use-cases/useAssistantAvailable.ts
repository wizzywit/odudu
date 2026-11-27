import { actingInOf, mayUseAssistant } from '#/entities/assistant';
import { useAuthority } from '#/entities/session';

// Whether whoami says the deployment has an assistant and the caller may use
// it, and the tenant it would act in when that is not the caller's own. False
// while whoami is out or failed, so nothing is asked, nothing drawn. A system
// administrator in another tenant has it there when they hold manage-tenants.
export function useAssistantAvailable(tenant: string): {
  available: boolean;
  actingIn: string | null;
} {
  const authority = useAuthority(tenant);
  return { available: mayUseAssistant(authority), actingIn: actingInOf(authority, tenant) };
}
