const KEY = 'odudu.console.rail';
const COLLAPSED = 'collapsed';

// A per-browser convenience, like the theme: storage that refuses, even at
// the getter, leaves the rail shown and the choice held for this page only.
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadRailCollapsed(): boolean {
  try {
    return storage()?.getItem(KEY) === COLLAPSED;
  } catch {
    return false;
  }
}

export function storeRailCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) storage()?.setItem(KEY, COLLAPSED);
    else storage()?.removeItem(KEY);
  } catch {
    // Unremembered, the choice still holds until the page is left.
  }
}
