import { useRootFailure } from '#/features/failure/use-cases/useRootFailure';
import { Button } from '#/shared/ui/Button';
import { FailurePanel } from '#/shared/ui/FailurePanel';
import { LostFrame } from '#/shared/ui/LostFrame';

// Drawn when everything above the router failed, so it reads no context the
// failed tree provided: only the design tokens and what its props carry.
export function RootFailure({ error, route }: { error: unknown; route: string }) {
  const failure = useRootFailure(error, route);
  const { view } = failure;
  return (
    <LostFrame brand={view.brand}>
      <FailurePanel
        {...view.panel}
        actions={
          <Button variant="primary" onPress={failure.reload}>
            {view.reload}
          </Button>
        }
      />
    </LostFrame>
  );
}
