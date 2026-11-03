import { pageShots } from '@site/src/features/landing/services/pageShot';
import { useShot, type ShotView } from '@site/src/shared/lib/use-cases/useShot';

// The two captures of one server page.
export function usePageShot(name: string): ShotView {
  return useShot(pageShots, name);
}
