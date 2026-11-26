import { mayUseAssistant } from '#/entities/assistant';
import { useAuthority } from '#/entities/session';

// Whether whoami says the deployment has an assistant and the caller may use
// it. False while whoami is out or failed, so nothing is asked, nothing drawn.
export function useAssistantAvailable(tenant: string): boolean {
  return mayUseAssistant(useAuthority(tenant));
}
