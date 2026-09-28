import { useEffect, useRef, useState } from 'react';
import { useSessionQuery } from '#/features/session/repository/useSessionQuery.ts';
import { draftOwner, type Principal } from '#/features/session/service.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { isSessionEnded } from '#/shared/transport/problem.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export type Boot =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly retry: () => void }
  | { readonly kind: 'ready'; readonly principal: Principal | null; readonly ended: boolean };

// A session ending mid-edit keeps every dirty section's non-secret edits in
// the tab, lets go of the guard so the sign-in can leave the page, and sends
// nothing: whatever was unsaved stays unsaved until somebody saves it.
export function useSession(): Boot {
  const { events } = useTransport();
  const { result, retry, markEnded } = useSessionQuery();
  const [ended, setEnded] = useState(false);
  const principal = result?.ok === true ? result.data : null;
  const latest = useRef({ principal, markEnded });
  useEffect(() => {
    latest.current = { principal, markEnded };
  });
  useEffect(
    () =>
      events.on('sessionEnded', () => {
        const { principal: who, markEnded: end } = latest.current;
        if (who !== null) useDrafts.getState().keepDirty(draftOwner(who));
        useUnsavedGuard.getState().reset();
        setEnded(true);
        end();
      }),
    [events],
  );

  if (result === undefined) return { kind: 'loading' };
  if (result.ok) return { kind: 'ready', principal: result.data, ended: false };
  if (result.kind === 'problem' && isSessionEnded(result.problem)) {
    return { kind: 'ready', principal: null, ended };
  }
  return { kind: 'failed', retry };
}
