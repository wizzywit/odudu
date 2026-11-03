import type { ErrorComponentProps } from '@tanstack/react-router';
import styles from '#/widgets/failure/ui/RouteFailure/RouteFailure.module.css';
import { useRouteFailure } from '#/widgets/failure/use-cases/useRouteFailure';
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
  const failure = useRouteFailure(error, reset, standalone);
  const { view } = failure;
  const panel = (
    <FailurePanel
      {...view.panel}
      actions={
        <>
          <Button variant="primary" onPress={failure.tryAgain}>
            {view.tryAgain}
          </Button>
          <ButtonLink href={failure.overviewHref}>{view.backToOverview}</ButtonLink>
          <Button onPress={failure.reload}>{view.reload}</Button>
        </>
      }
    />
  );
  return standalone ? (
    <LostFrame brand={view.brand}>{panel}</LostFrame>
  ) : (
    <div className={styles.inShell}>{panel}</div>
  );
}
