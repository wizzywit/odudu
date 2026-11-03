import { reloadWindow } from '#/widgets/failure/repository/failureReport';
import { rootFailureView } from '#/widgets/failure/services/failureView';
import { useFailureReport } from '#/widgets/failure/use-cases/useFailureReport';

export function useRootFailure(error: unknown, route: string) {
  const shown = useFailureReport(error, route);
  return {
    view: rootFailureView(shown),
    // Not through the unsaved-changes guard: the whole tree, every form and
    // the guard's dialog included, is already gone.
    reload: reloadWindow,
  };
}
