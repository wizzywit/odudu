import { brandText } from '#/widgets/shell/services/shellText';
import { useRailCollapsed } from '#/widgets/shell/repository/useRailCollapsed';

// The collapse the rail will have when the session is read, so the page
// column sits where it will stay.
export function usePendingFrame(tenant: string): { collapsed: boolean; brand: string } {
  const [collapsed] = useRailCollapsed();
  return { collapsed, brand: brandText(tenant) };
}
