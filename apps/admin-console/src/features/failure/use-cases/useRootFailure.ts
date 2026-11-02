import { reloadWindow } from '#/features/failure/repository/failureReport';
import { useFailureReport, type FailureShown } from '#/features/failure/use-cases/useFailureReport';

export interface RootFailureShown extends FailureShown {
  // Not through the unsaved-changes guard: the whole tree, every form and
  // the guard's dialog included, is already gone.
  reload: () => void;
}

export function useRootFailure(error: unknown, route: string): RootFailureShown {
  const shown = useFailureReport(error, route);
  return {
    report: shown.report,
    details: shown.details,
    message: shown.message,
    messageLabel: shown.messageLabel,
    reload: reloadWindow,
  };
}
