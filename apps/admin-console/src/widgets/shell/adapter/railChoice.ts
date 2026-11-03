import { browserStorage } from '#/shared/adapter/browserStorage';

const KEY = 'odudu.console.rail';
const COLLAPSED = 'collapsed';

export function loadRailCollapsed(): boolean {
  try {
    return browserStorage('local')?.getItem(KEY) === COLLAPSED;
  } catch {
    return false;
  }
}

export function storeRailCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) browserStorage('local')?.setItem(KEY, COLLAPSED);
    else browserStorage('local')?.removeItem(KEY);
  } catch {
    // Unremembered, the choice still holds until the page is left.
  }
}
