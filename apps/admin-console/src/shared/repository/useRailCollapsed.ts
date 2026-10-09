import { useState } from 'react';
import { loadRailCollapsed, storeRailCollapsed } from '#/shared/adapter/railChoice.ts';

// Whether the rail is collapsed, starting from this browser's last choice
// and remembering every new one.
export function useRailCollapsed(): readonly [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(loadRailCollapsed);
  return [
    collapsed,
    (next) => {
      storeRailCollapsed(next);
      setCollapsed(next);
    },
  ];
}
