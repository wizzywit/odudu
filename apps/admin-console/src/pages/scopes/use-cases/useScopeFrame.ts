import { scopesTrail } from '#/entities/scope';
import { scopeFrames, type ScopeFrames } from '#/pages/scopes/services/scopeFrame';

export function useScopeFrame(tenant: string): ScopeFrames {
  return scopeFrames(tenant, scopesTrail);
}
