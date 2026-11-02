import { useState } from 'react';
import type { EndTenantSessionsResponse, TenantSession } from '@odudu/contracts/admin';
import { useAuthority, usePrincipal, useRefusal } from '#/features/session';
import { subjectHref } from '#/features/subjects';
import {
  useEndTenantSessions,
  useTenantSessionList,
} from '#/features/tenant-sessions/repository/useTenantSessions';
import {
  endConsequence,
  endedText,
  endFailure,
  endMoreText,
  subjectLinkOf,
} from '#/features/tenant-sessions/services';
import { useToast } from '#/shared/repository/useToasts';
import { holds } from '#/shared/services/access';
import { isOwnTenant } from '#/shared/services/principal';
import type { ResourceListState } from '#/shared/services/resourceList';
import { useConfirmedChange, type Confirming } from '#/shared/use-cases/useConfirmedChange';

export interface TenantSessionsPage {
  list: ResourceListState<TenantSession>;
  // Where a session's subject has its page, or null where the caller may not read subjects.
  subjectLink: ((id: string) => string) | null;
  endAll: Confirming<'all'>;
  consequence: string;
  // What stays beside the button while more sessions are live.
  more: string | null;
}

export function useTenantSessionsPage(tenant: string): TenantSessionsPage {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const principal = usePrincipal();
  const authority = useAuthority(tenant);
  const [more, setMore] = useState<string | null>(null);
  return {
    list: useTenantSessionList(tenant),
    subjectLink: subjectLinkOf(holds(authority, 'view-users'), tenant, subjectHref),
    endAll: useConfirmedChange<'all', EndTenantSessionsResponse>({
      refusal,
      capability: 'manage-sessions',
      change: useEndTenantSessions(tenant),
      failureText: (failure) => endFailure(tenant, failure),
      done: (_all, answer) => {
        toast.succeeded(endedText(tenant, answer));
        setMore(endMoreText(tenant, answer));
      },
    }),
    consequence: endConsequence(tenant, isOwnTenant(principal, tenant)),
    more,
  };
}
