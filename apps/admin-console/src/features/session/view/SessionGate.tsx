import type { ReactNode } from 'react';
import { useSession } from '#/features/session/usecase/useSession.ts';
import { usePlaceholderDue } from '#/features/session/usecase/usePlaceholderDue.ts';
import { SignedInContext } from '#/features/session/usecase/useSignedIn.ts';
import { PrincipalChanged } from '#/features/session/view/PrincipalChanged.tsx';
import { SessionStatus } from '#/features/session/view/SessionStatus.tsx';
import { Button } from '#/shared/view/Button';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import styles from '#/features/session/view/SignIn.module.css';
import { QuietSkeletons, Skeleton } from '#/shared/view/Skeleton.tsx';
import { VisuallyHidden } from '#/shared/view/VisuallyHidden';

// Nothing is drawn for a fast read. The status line is one element from the
// first render to the last, so a screen reader is told throughout.
function Reading({ frame }: { frame: ReactNode }) {
  const due = usePlaceholderDue();
  return (
    <>
      <VisuallyHidden role="status">Reading your session</VisuallyHidden>
      {due ? (
        <QuietSkeletons>
          {frame ?? (
            <SessionStatus title="Odudu console">
              <Skeleton label="Reading your session" lines={2} />
            </SessionStatus>
          )}
        </QuietSkeletons>
      ) : null}
    </>
  );
}

// `pending` is what stands in for the page behind the gate, where the
// address names one; without it the gate shows the console's own card.
export function SessionGate({ pending, children }: { pending?: ReactNode; children: ReactNode }) {
  const boot = useSession();
  if (boot.kind === 'loading') return <Reading frame={pending} />;
  if (boot.kind === 'failed') {
    return (
      <SessionStatus title="Odudu console">
        <EmptyState
          variant="failed"
          title="The console could not reach the server"
          action={<Button onPress={boot.retry}>Try again</Button>}
        >
          Nothing was changed. Check the connection and try again.
        </EmptyState>
      </SessionStatus>
    );
  }
  if (boot.kind === 'replaced') {
    return (
      <PrincipalChanged
        was={boot.was}
        now={boot.now}
        onCarryOn={boot.carryOn}
        onSignInAgain={boot.signInAgain}
      />
    );
  }
  return (
    <SignedInContext value={{ principal: boot.principal, ended: boot.ended }}>
      {children}
    </SignedInContext>
  );
}
