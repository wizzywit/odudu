import { useRailCollapsed } from '#/shared/repository/useRailCollapsed.ts';

// The collapse the rail will have when the session is read, so the page
// column sits where it will stay.
export function usePendingFrame(): boolean {
  const [collapsed] = useRailCollapsed();
  return collapsed;
}
