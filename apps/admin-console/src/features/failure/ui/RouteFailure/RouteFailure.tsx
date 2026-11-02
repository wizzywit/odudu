import type { ErrorComponentProps } from '@tanstack/react-router';
import {
  PANEL_WORDING,
  BACK_TO_OVERVIEW_LABEL,
  RELOAD_LABEL,
  ROUTE_FAILURE_TEXT,
  SHELL_FAILURE_TEXT,
  TRY_AGAIN_LABEL,
} from '#/features/failure/services';
import styles from '#/features/failure/ui/RouteFailure/RouteFailure.module.css';
import { useRouteFailure } from '#/features/failure/use-cases/useRouteFailure';
import { PRODUCT_NAME } from '#/shared/services/product';
import { Button } from '#/shared/ui/Button';
import { FailurePanel } from '#/shared/ui/FailurePanel';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { LostFrame } from '#/shared/ui/LostFrame';

// Inside the shell, which stays around it, or, where the shell itself is
// what failed, alone on the page under the product's name.
export function RouteFailure({
  error,
  reset,
  standalone = false,
}: ErrorComponentProps & { standalone?: boolean }) {
  const failure = useRouteFailure(error, reset);
  const panel = (
    <FailurePanel
      {...PANEL_WORDING}
      text={standalone ? SHELL_FAILURE_TEXT : ROUTE_FAILURE_TEXT}
      message={failure.message}
      messageLabel={failure.messageLabel}
      details={failure.details}
      actions={
        <>
          <Button variant="primary" onPress={failure.tryAgain}>
            {TRY_AGAIN_LABEL}
          </Button>
          <ButtonLink href={failure.overviewHref}>{BACK_TO_OVERVIEW_LABEL}</ButtonLink>
          <Button onPress={failure.reload}>{RELOAD_LABEL}</Button>
        </>
      }
    />
  );
  return standalone ? (
    <LostFrame brand={PRODUCT_NAME}>{panel}</LostFrame>
  ) : (
    <div className={styles.inShell}>{panel}</div>
  );
}
