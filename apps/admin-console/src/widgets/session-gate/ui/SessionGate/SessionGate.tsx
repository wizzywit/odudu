import type { ReactNode } from 'react';
import { useSession, SessionStatus, SignedInContext } from '#/entities/session';
import { usePlaceholderDue } from '#/widgets/session-gate/use-cases/usePlaceholderDue';
import { PrincipalChanged } from '#/widgets/session-gate/ui/PrincipalChanged';
import { Button } from '#/shared/ui/Button';
import { EmptyState } from '#/shared/ui/EmptyState';
import { QuietSkeletons, Skeleton } from '#/shared/ui/Skeleton';
import { VisuallyHidden } from '#/shared/ui/VisuallyHidden';

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
            <SessionStatus>
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
      <SessionStatus>
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
