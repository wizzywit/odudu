import type { ReactNode } from 'react';
import { useSession } from '#/features/session/usecase/useSession.ts';
import { SignedInContext } from '#/features/session/usecase/useSignedIn.ts';
import { PrincipalChanged } from '#/features/session/view/PrincipalChanged.tsx';
import { SessionStatus } from '#/features/session/view/SessionStatus.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';

export function SessionGate({ children }: { children: ReactNode }) {
  const boot = useSession();
  if (boot.kind === 'loading') {
    return (
      <SessionStatus title="Odudu console">
        <Skeleton label="Reading your session" lines={2} />
      </SessionStatus>
    );
  }
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
