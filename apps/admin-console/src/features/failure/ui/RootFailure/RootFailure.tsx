import {
  PANEL_WORDING,
  RELOAD_LABEL,
  ROOT_FAILURE_TEXT,
} from '#/features/failure/services/wording';
import { useRootFailure } from '#/features/failure/use-cases/useRootFailure';
import { PRODUCT_NAME } from '#/shared/services/product';
import { Button } from '#/shared/ui/Button';
import { FailurePanel } from '#/shared/ui/FailurePanel';
import { LostFrame } from '#/shared/ui/LostFrame';

// Drawn when everything above the router failed, so it reads no context the
// failed tree provided: only the design tokens and what its props carry.
export function RootFailure({ error, route }: { error: unknown; route: string }) {
  const failure = useRootFailure(error, route);
  return (
    <LostFrame brand={PRODUCT_NAME}>
      <FailurePanel
        {...PANEL_WORDING}
        text={ROOT_FAILURE_TEXT}
        message={failure.message}
        messageLabel={failure.messageLabel}
        details={failure.details}
        actions={
          <Button variant="primary" onPress={failure.reload}>
            {RELOAD_LABEL}
          </Button>
        }
      />
    </LostFrame>
  );
}
