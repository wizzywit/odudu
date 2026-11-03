import { reloadWindow } from '#/features/failure/repository/failureReport';
import { rootFailureView } from '#/features/failure/services/failureView';
import { useFailureReport } from '#/features/failure/use-cases/useFailureReport';

export function useRootFailure(error: unknown, route: string) {
  const shown = useFailureReport(error, route);
  return {
    view: rootFailureView(shown),
    // Not through the unsaved-changes guard: the whole tree, every form and
    // the guard's dialog included, is already gone.
    reload: reloadWindow,
  };
}
