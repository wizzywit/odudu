import { useSessionEvent, useSessionQuery } from '#/entities/session/repository/useSessionQuery';
import { type Principal } from '#/entities/session/types/principal';
import { bootOf, draftOwner, shownPrincipal } from '#/entities/session/services/boot';
import { useSignIn } from '#/entities/session/use-cases/useSignIn';
import { useDrafts } from '#/shared/repository/useDrafts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';

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
  const keepDirty = useDrafts((drafts) => drafts.keepDirty);
  const reset = useUnsavedGuard((guard) => guard.reset);
  const principal = shownPrincipal(read);
  useSessionEvent('authEnded', () => {
    if (principal !== null) keepDirty(draftOwner(principal));
    reset();
    markEnded(principal);
  });
  useSessionEvent('principalChanged', retry);

  const boot = bootOf(read);
  if (boot.kind === 'failed') return { kind: 'failed', retry };
  if (boot.kind !== 'replaced') return boot;
  return {
    ...boot,
    carryOn,
    signInAgain: () => {
      signIn(boot.was.tenant);
    },
  };
}
