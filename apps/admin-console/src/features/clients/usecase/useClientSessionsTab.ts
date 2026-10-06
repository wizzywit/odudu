import type { Client, TenantSession } from '@odudu/contracts/admin';
import { useState } from 'react';
import { subjectHref } from '#/features/subjects';
import { useAuthority, useRefusal } from '#/features/session';
import { useRereadClient } from '#/features/clients/repository/useClientRecord.ts';
import {
  useClientSessionList,
  useGrantRevocation,
} from '#/features/clients/repository/useClientSessions.ts';
import {
  canChange,
  ceilingRefused,
  revokeConsequence,
  revokedText,
  revokeFailureText,
  SESSIONS_CAPABILITY,
  type Reach,
} from '#/features/clients/service';
import { useGo } from '#/shared/repository/useGo.ts';
import { lacking } from '#/shared/service/access.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

// Whether the caller may read them: whoami says manage-sessions is held,
// or has not yet answered.
export function useSessionsReadable(tenant: string): boolean {
  return lacking(useAuthority(tenant), [SESSIONS_CAPABILITY]).length === 0;
}

export interface ClientSessions {
  list: ResourceListState<TenantSession>;
  open: (subjectId: string) => void;
  // Whether revoking is offered: the capability is held and the client's
  // service account is within the caller's reach.
  offered: boolean;
  confirming: boolean;
  consequence: string;
  busy: boolean;
  problem: string | null;
  // What the last revocation did, in one line.
  result: string | null;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
}

export function useClientSessionsTab(tenant: string, client: Client, reach: Reach): ClientSessions {
  const authority = useAuthority(tenant);
  const refusal = useRefusal(tenant);
  const reread = useRereadClient(tenant, client.id);
  const list = useClientSessionList(tenant, client.id);
  const revocation = useGrantRevocation(tenant, client.id);
  const go = useGo();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const needs = lacking(authority, [SESSIONS_CAPABILITY]);

  const failed = (failure: GatewayFailure): void => {
    refusal.report(failure, SESSIONS_CAPABILITY);
    if (ceilingRefused(failure)) reread();
    setProblem(revokeFailureText(failure, client.name));
  };

  return {
    list,
    open: (subjectId) => {
      go(subjectHref(tenant, subjectId));
    },
    offered: canChange(reach, needs),
    confirming,
    consequence: revokeConsequence(client.name),
    busy: revocation.busy,
    problem,
    result,
    ask: () => {
      setProblem(null);
      setConfirming(true);
    },
    cancel: () => {
      setProblem(null);
      setConfirming(false);
    },
    confirm: () => {
      if (revocation.busy) return;
      setProblem(null);
      revocation
        .run()
        .then((answer) => {
          if (!answer.ok) {
            failed(answer);
            return;
          }
          setConfirming(false);
          setResult(revokedText(client.name, answer.data));
        })
        .catch(() => {
          failed({ ok: false, kind: 'defect' });
        });
    },
  };
}
