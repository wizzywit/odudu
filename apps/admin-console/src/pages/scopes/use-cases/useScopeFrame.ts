import { scopesTrail } from '#/entities/scope';
import { NEW_SCOPE_TITLE, SCOPE_TITLE } from '#/pages/scopes/services/scopeDetails';

export interface PageFrame {
  title: string;
  breadcrumb: ReturnType<typeof scopesTrail>;
}

// What the area gate shows in place of a page it does not let through.
export interface ScopeFrame {
  record: PageFrame;
  creation: PageFrame;
}

export function useScopeFrame(tenant: string): ScopeFrame {
  return {
    record: { title: SCOPE_TITLE, breadcrumb: scopesTrail(tenant, SCOPE_TITLE) },
    creation: { title: NEW_SCOPE_TITLE, breadcrumb: scopesTrail(tenant, NEW_SCOPE_TITLE) },
  };
}
