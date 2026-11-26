import { mayUseAssistant } from '#/entities/assistant';
import { useAuthority } from '#/entities/session';
import { signedInFrom } from '#/widgets/shell/services/shellText';

// Whether whoami says the deployment has an assistant and the caller may use
// it. False while whoami is out or failed, so nothing is asked, nothing drawn;
// and false for an administrator signed in to another tenant, who may read this
// one but has no subject here to own a conversation, so the server would not
// serve them one.
export function useAssistantAvailable(tenant: string, signedInTo: string): boolean {
  const authority = useAuthority(tenant);
  return mayUseAssistant(authority) && signedInFrom(signedInTo, tenant) === null;
}
