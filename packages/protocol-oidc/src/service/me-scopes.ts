import { holdsMeScope, ME_READ_SCOPE, ME_WRITE_SCOPE } from '@odudu/domain-tenant';

export {
  holdsMeScope,
  isMeScope,
  ME_READ_SCOPE,
  ME_SCOPES,
  ME_WRITE_SCOPE,
} from '@odudu/domain-tenant';

// A request that names the "me" audience has to ask for a "me" scope, and a
// request for me:write, at any audience, carries me:read with it.
export function meAudienceRequestAllowed(
  scopes: readonly string[],
  audiences: readonly string[],
  meAudience: string,
): boolean {
  if (scopes.includes(ME_WRITE_SCOPE) && !scopes.includes(ME_READ_SCOPE)) return false;
  return !audiences.includes(meAudience) || holdsMeScope(scopes);
}
