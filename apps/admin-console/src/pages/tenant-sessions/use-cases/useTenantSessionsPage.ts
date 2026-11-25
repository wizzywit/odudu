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
import {
  END_IDLE,
  NOTHING_YET,
  NOUN,
  PAGE_RULE,
} from '#/pages/tenant-sessions/services/sessionListText';
import { subjectCell } from '#/pages/tenant-sessions/services/sessionSubject';
import { useToast } from '#/shared/lib/repository/useToasts';
import { holds } from '#/shared/lib/services/access';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { useConfirmedChange, type Confirming } from '#/shared/lib/use-cases/useConfirmedChange';
import { usernameOrId, subjectHref, subjectLinkOf } from '#/entities/subject';

export interface TenantSessionsPage {
  list: ResourceListState<TenantSession>;
  deviceCaption: (device: string | null) => string | null;
  // Where a session's subject has its page, or null where the caller may not read subjects.
  subjectLink: ((id: string) => string) | null;
  endAll: Confirming<'all'>;
  // Whether End every session is held, there being no session to end.
  endHeld: boolean;
  consequence: string;
  // What stays beside the button while more sessions are live.
  more: string | null;
  text: { noun: typeof NOUN; rule: string; nothingYet: string; endIdle: string };
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
    endHeld: list.rows.length === 0,
    consequence: endConsequence(tenant, isOwnTenant(principal, tenant)),
    more,
    text: { noun: NOUN, rule: PAGE_RULE, nothingYet: NOTHING_YET, endIdle: END_IDLE },
    subjectOf: (session) =>
      subjectCell(session, usernameOrId({ id: session.subjectId, username: session.username })),
  };
}
