import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { readSession } from '#/features/session/adapter/session.ts';
import { loadLastTenant, storeLastTenant } from '#/features/session/adapter/lastTenant.ts';
import {
  draftOwner,
  isReplacement,
  remembers,
  sessionEndedRead,
  shownPrincipal,
  type Principal,
  type SessionRead,
} from '#/features/session/service.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import type { Gateway } from '#/shared/transport/gateway.ts';
import type { SessionEvents } from '#/shared/service/sessionEvents.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

const KEY = ['session'] as const;

// An ended or replaced session's server data belongs to nobody now, so none
// of it stays in the cache for whoever is signed in next.
function purge(client: QueryClient): void {
  client.removeQueries({ predicate: (cached) => cached.queryKey[0] !== KEY[0] });
}

function adopt(gateway: Gateway, principal: Principal): void {
  useDrafts.getState().adopt(draftOwner(principal));
  storeLastTenant(principal.tenant);
  gateway.believe(principal.subjectId);
}

// Settled before any page renders, so a section restoring a draft never
// sees one another administrator left in this tab. A read naming somebody
// other than the principal shown is another tab's sign-in: this tab's edits
// are kept for the principal they were made as, while its sections are
// still mounted, and nothing is adopted until the administrator says so.
async function signedIn(gateway: Gateway, client: QueryClient): Promise<SessionRead> {
  const before = shownPrincipal(client.getQueryData<SessionRead>(KEY));
  const result = await readSession(gateway);
  if (!result.ok) return { result, was: null };
  if (before === null) {
    adopt(gateway, result.data);
    return { result, was: null };
  }
  if (!isReplacement(before, result.data)) return { result, was: null };
  useDrafts.getState().keepDirty(draftOwner(before));
  useUnsavedGuard.getState().reset();
  purge(client);
  return { result, was: before };
}

export function rememberedTenant({
  named,
  signedIn,
}: {
  named: string | null;
  signedIn: boolean;
}): string | null {
  return remembers(named, signedIn) ? loadLastTenant() : null;
}

export function useSessionQuery(): {
  read: SessionRead | undefined;
  retry: () => void;
  markEnded: (was: Principal | null) => void;
  // Takes the principal another sign-in left as this tab's own.
  carryOn: () => void;
} {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => signedIn(gateway, client) });
  return {
    read: query.data,
    retry: () => {
      client.refetchQueries({ queryKey: KEY }).catch(() => undefined);
    },
    markEnded: (was) => {
      purge(client);
      client.setQueryData<SessionRead>(KEY, { result: sessionEndedRead(), was });
    },
    carryOn: () => {
      const read = client.getQueryData<SessionRead>(KEY);
      if (read?.result.ok !== true) return;
      adopt(gateway, read.result.data);
      client.setQueryData<SessionRead>(KEY, { result: read.result, was: null });
    },
  };
}

// Called when the gateway reports this session over, or replaced by another
// sign-in, from whichever request found out.
export function useSessionEvent(
  name: Parameters<SessionEvents['on']>[0],
  listener: () => void,
): void {
  const { events } = useTransport();
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(
    () =>
      events.on(name, () => {
        latest.current();
      }),
    [events, name],
  );
}
