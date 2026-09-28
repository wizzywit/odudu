import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readSession } from '#/features/session/adapter/session.ts';
import { loadLastTenant, storeLastTenant } from '#/features/session/adapter/lastTenant.ts';
import { draftOwner, type Principal } from '#/features/session/service.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { SESSION_ENDED_TYPE } from '#/shared/transport/problem.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

const KEY = ['session'] as const;

const ENDED: GatewayResult<Principal> = {
  ok: false,
  kind: 'problem',
  problem: { type: SESSION_ENDED_TYPE, title: 'Unauthorized', status: 401 },
};

// Settled before any page renders, so a section restoring a draft never
// sees one another administrator left in this tab.
async function signedIn(gateway: Gateway): Promise<GatewayResult<Principal>> {
  const result = await readSession(gateway);
  if (result.ok) {
    useDrafts.getState().adopt(draftOwner(result.data));
    storeLastTenant(result.data.tenant);
  }
  return result;
}

// The tenant this browser last signed in to is only a fallback: a tenant
// the URL names, or a live session, always comes first.
export function rememberedTenant({
  named,
  signedIn,
}: {
  readonly named: string | null;
  readonly signedIn: boolean;
}): string | null {
  return named === null && !signedIn ? loadLastTenant() : null;
}

export function useSessionQuery(): {
  readonly result: GatewayResult<Principal> | undefined;
  readonly retry: () => void;
  readonly markEnded: () => void;
} {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => signedIn(gateway) });
  return {
    result: query.data,
    retry: () => {
      client.refetchQueries({ queryKey: KEY }).catch(() => undefined);
    },
    // An ended session's server data belongs to nobody now, so none of it
    // stays in the cache for whoever signs in next.
    markEnded: () => {
      client.removeQueries({ predicate: (cached) => cached.queryKey[0] !== KEY[0] });
      client.setQueryData(KEY, ENDED);
    },
  };
}
