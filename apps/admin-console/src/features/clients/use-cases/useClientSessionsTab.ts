import type { Client, TenantSession } from '@odudu/contracts/admin';
import { useState } from 'react';
import { subjectHref } from '#/features/subjects';
import { useAuthority, useRefusal } from '#/features/session';
import { useRereadClient } from '#/features/clients/repository/useClientRecord';
import {
  useClientSessionList,
  useGrantRevocation,
} from '#/features/clients/repository/useClientSessions';
import { canChange, type Reach } from '#/features/clients/services/ceiling';
import { ceilingRefused } from '#/features/clients/services/refusal';
import {
  revokeConsequence,
  revokedText,
  revokeFailureText,
  SESSIONS_CAPABILITY,
  sessionsReadable,
} from '#/features/clients/services/sessions';
import { useGo } from '#/shared/repository/useGo';
import { lacking } from '#/shared/services/access';
import type { ResourceListState } from '#/shared/services/resourceList';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';

// Whether the caller may read them: whoami says manage-sessions is held,
// or has not yet answered.
export function useSessionsReadable(tenant: string): boolean {
  return sessionsReadable(useAuthority(tenant));
}

export interface ClientSessions extends Removal {
  list: ResourceListState<TenantSession>;
  open: (subjectId: string) => void;
  // Whether revoking is offered: the capability is held and the client's
  // service account is within the caller's reach.
  offered: boolean;
  consequence: string;
  // What the last revocation did, in one line.
  result: string | null;
}

export function useClientSessionsTab(tenant: string, client: Client, reach: Reach): ClientSessions {
  const authority = useAuthority(tenant);
  const refusal = useRefusal(tenant);
  const reread = useRereadClient(tenant, client.id);
  const list = useClientSessionList(tenant, client.id);
  const revocation = useGrantRevocation(tenant, client.id);
  const go = useGo();
  const [result, setResult] = useState<string | null>(null);
  const needs = lacking(authority, [SESSIONS_CAPABILITY]);
  const removal = useConfirmedRemoval({
    refusal,
    capability: SESSIONS_CAPABILITY,
    change: revocation,
    failureText: (failure) => revokeFailureText(failure, client.name),
    onRefused: (failure) => {
      if (ceilingRefused(failure)) reread();
    },
    done: (answer) => {
      setResult(revokedText(client.name, answer));
    },
  });

  return {
    list,
    open: (subjectId) => {
      go(subjectHref(tenant, subjectId));
    },
    ...removal,
    offered: canChange(reach, needs),
    consequence: revokeConsequence(client.name, client.builtin_admin),
    result,
  };
}
