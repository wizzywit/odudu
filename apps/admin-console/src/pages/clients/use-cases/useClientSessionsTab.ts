import type { Client } from '#/entities/client';
import type { ClientSession } from '#/pages/clients/types/clientSession';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/entities/session';
import { useRereadClient } from '#/pages/clients/repository/useClientRecord';
import {
  useClientSessionList,
  useGrantRevocation,
} from '#/pages/clients/repository/useClientSessions';
import { canChange, type ServiceAccountReach } from '#/pages/clients/services/ceiling';
import { ceilingRefused } from '#/pages/clients/services/refusal';
import {
  revokeConsequence,
  revokedText,
  revokeFailureText,
  SESSIONS_CAPABILITY,
} from '#/pages/clients/services/sessions';
import { useGo } from '#/shared/repository/useGo';
import { lacking, readable } from '#/shared/services/access';
import type { ResourceListState } from '#/shared/services/resourceList';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';
import { subjectHref, usernameOrId } from '#/entities/subject';

// Whether the caller may read them: whoami says manage-sessions is held,
// or has not yet answered.
export function useSessionsReadable(tenant: string): boolean {
  return readable(useAuthority(tenant), SESSIONS_CAPABILITY);
}

export interface ClientSessions extends Removal {
  list: ResourceListState<ClientSession>;
  open: (subjectId: string) => void;
  // How a session names its subject: the username, or the ID when it has none.
  subjectLabel: (session: ClientSession) => string;
  // Whether revoking is offered: the capability is held and the client's
  // service account is within the caller's reach.
  offered: boolean;
  consequence: string;
  // What the last revocation did, in one line.
  result: string | null;
}

export function useClientSessionsTab(
  tenant: string,
  client: Client,
  reach: ServiceAccountReach,
): ClientSessions {
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
    subjectLabel: (session) => usernameOrId({ id: session.subject_id, username: session.username }),
    ...removal,
    offered: canChange(reach, needs),
    consequence: revokeConsequence(client.name, client.builtin_admin),
    result,
  };
}
