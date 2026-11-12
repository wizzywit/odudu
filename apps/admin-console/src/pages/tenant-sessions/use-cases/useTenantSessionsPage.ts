import { deviceCaptionOf, groupByDevice } from '#/entities/session';
import { useState } from 'react';
import type { SessionsEnded, TenantSession } from '#/pages/tenant-sessions/types/tenantSession';
import { useAuthority, usePrincipal, useRefusal, isOwnTenant } from '#/entities/session';
import {
  useEndTenantSessions,
  useTenantSessionList,
} from '#/pages/tenant-sessions/repository/useTenantSessions';
import {
  endConsequence,
  endedText,
  endFailure,
  endMoreText,
} from '#/pages/tenant-sessions/services/endSessions';
import { NOTHING_YET, NOUN, PAGE_RULE } from '#/pages/tenant-sessions/services/sessionListText';
import { subjectCell, subjectLinkOf } from '#/pages/tenant-sessions/services/sessionSubject';
import { useToast } from '#/shared/lib/repository/useToasts';
import { holds } from '#/shared/lib/services/access';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { useConfirmedChange, type Confirming } from '#/shared/lib/use-cases/useConfirmedChange';
import { usernameOrId, subjectHref } from '#/entities/subject';

export interface TenantSessionsPage {
  list: ResourceListState<TenantSession>;
  deviceCaption: (device: string | null) => string | null;
  // Where a session's subject has its page, or null where the caller may not read subjects.
  subjectLink: ((id: string) => string) | null;
  endAll: Confirming<'all'>;
  consequence: string;
  // What stays beside the button while more sessions are live.
  more: string | null;
  text: { noun: typeof NOUN; rule: string; nothingYet: string };
  // How a session names its subject: a label to read and the id it goes by.
  subjectOf: (session: TenantSession) => ReturnType<typeof subjectCell>;
}

export function useTenantSessionsPage(tenant: string): TenantSessionsPage {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const principal = usePrincipal();
  const authority = useAuthority(tenant);
  const [more, setMore] = useState<string | null>(null);
  const list = useTenantSessionList(tenant);
  return {
    list: { ...list, rows: groupByDevice(list.rows) },
    deviceCaption: deviceCaptionOf(list.rows),
    subjectLink: subjectLinkOf(holds(authority, 'view-users'), tenant, subjectHref),
    endAll: useConfirmedChange<'all', SessionsEnded>({
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
    text: { noun: NOUN, rule: PAGE_RULE, nothingYet: NOTHING_YET },
    subjectOf: (session) =>
      subjectCell(session, usernameOrId({ id: session.subjectId, username: session.username })),
  };
}
