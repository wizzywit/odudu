import {
  consoleShots,
  loadingFor,
  type ShotLoading,
} from '@site/src/shared/lib/services/consoleShot';
import { useShot, type ShotView } from '@site/src/shared/lib/use-cases/useShot';

export interface ConsoleShotView {
  shot: ShotView;
  loading: ShotLoading;
}

// The two captures of one console page, and how the light one is to be fetched.
export function useConsoleShot(name: string, priority: boolean): ConsoleShotView {
  return { shot: useShot(consoleShots, name), loading: loadingFor(priority) };
}
