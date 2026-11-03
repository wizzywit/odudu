import { SYSTEM_TENANT } from '#/shared/services/principal';

const SYSTEM_FIXED =
  'system cannot be disabled: it is the tenant every cross-tenant administrator signs in to.';

// Why a tenant cannot be enabled or disabled, shown as fixed text.
export function disableFixed(name: string): string | null {
  return name === SYSTEM_TENANT ? SYSTEM_FIXED : null;
}

// `signedInHere`: the operator's own console session is in this tenant, so
// disabling it ends theirs too.
export function disableConsequence(tenant: string, signedInHere: boolean): string {
  const own = signedInHere ? ` Your own console session in ${tenant} ends too.` : '';
  return `Nobody can sign in to ${tenant} while it is disabled, and its discovery document, tokens and endpoints answer as for a tenant that does not exist. Only a system administrator can enable it again.${own}`;
}
