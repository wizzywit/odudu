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
  NO_SESSIONS,
  REVOKE_HEADING,
  REVOKE_RULE,
  revokeConsequence,
  revokedText,
  revokeFailureText,
  SESSIONS_CAPABILITY,
  SESSIONS_NOUN,
  SESSIONS_RULE,
} from '#/pages/clients/services/sessions';
import { useGo } from '#/shared/repository/useGo';
import { lacking, readable } from '#/shared/services/access';
import type { AdminCapability } from '#/shared/services/principal';
import type { ResourceListState } from '#/shared/services/resourceList';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';
import { subjectHref, usernameOrId } from '#/entities/subject';

export interface SessionsPanel {
  // Whether the caller may read them: whoami says manage-sessions is held,
  // or has not yet answered.
  readable: boolean;
  capability: AdminCapability;
}

export function useSessionsPanel(tenant: string): SessionsPanel {
  return {
    readable: readable(useAuthority(tenant), SESSIONS_CAPABILITY),
    capability: SESSIONS_CAPABILITY,
  };
}

export interface ClientSessions extends Removal {
  rule: string;
  empty: string;
  noun: { one: string; other: string };
  capability: AdminCapability;
  revokeHeading: string;
  revokeRule: string;
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
    rule: SESSIONS_RULE,
    empty: NO_SESSIONS,
    noun: SESSIONS_NOUN,
    capability: SESSIONS_CAPABILITY,
    revokeHeading: REVOKE_HEADING,
    revokeRule: REVOKE_RULE,
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
