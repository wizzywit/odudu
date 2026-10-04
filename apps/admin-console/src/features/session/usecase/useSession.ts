import { useSessionEvent, useSessionQuery } from '#/features/session/repository/useSessionQuery.ts';
import { draftOwner, type Principal } from '#/features/session/service.ts';
import { useSignIn } from '#/features/session/usecase/useSignIn.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { isSessionEnded } from '#/shared/service/sessionEnded.ts';

export type Boot =
  | { kind: 'loading' }
  | { kind: 'failed'; retry: () => void }
  | {
      kind: 'replaced';
      was: Principal;
      now: Principal;
      carryOn: () => void;
      signInAgain: () => void;
    }
  | {
      kind: 'ready';
      principal: Principal | null;
      ended: Principal | null;
    };

// A session ending mid-edit keeps every dirty section's non-secret edits in
// the tab, lets go of the guard so the sign-in can leave the page, and sends
// nothing: whatever was unsaved stays unsaved until somebody saves it. A
// session another tab's sign-in replaced is the same end for this tab, and
// it asks before it becomes the new principal's.
export function useSession(): Boot {
  const { read, retry, markEnded, carryOn } = useSessionQuery();
  const signIn = useSignIn();
  const principal = read?.result.ok === true ? (read.was ?? read.result.data) : null;
  useSessionEvent('sessionEnded', () => {
    if (principal !== null) useDrafts.getState().keepDirty(draftOwner(principal));
    useUnsavedGuard.getState().reset();
    markEnded(principal);
  });
  useSessionEvent('principalChanged', retry);

  if (read === undefined) return { kind: 'loading' };
  const { result, was } = read;
  if (result.ok && was !== null) {
    return {
      kind: 'replaced',
      was,
      now: result.data,
      carryOn,
      signInAgain: () => {
        signIn(was.tenant);
      },
    };
  }
  if (result.ok) return { kind: 'ready', principal: result.data, ended: null };
  if (result.kind === 'problem' && isSessionEnded(result.problem)) {
    return { kind: 'ready', principal: null, ended: was };
  }
  return { kind: 'failed', retry };
}
