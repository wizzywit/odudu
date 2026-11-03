import { NEW_SCOPE_TITLE, SCOPE_TITLE } from '#/pages/scopes/services/scopeDetails';
import { pageFrame, type PageFrame } from '#/shared/lib/services/address';

export interface ScopeFrames {
  record: PageFrame;
  creation: PageFrame;
}

export function scopeFrames(tenant: string, trail: Parameters<typeof pageFrame>[0]): ScopeFrames {
  return {
    record: pageFrame(trail, tenant, SCOPE_TITLE),
    creation: pageFrame(trail, tenant, NEW_SCOPE_TITLE),
  };
}
