import { useEffect, type RefObject } from 'react';
import { focusIsLost } from '#/shared/lib/platform/focus';

// Focus the element once `active` turns true, but only when the page has
// lost its focus, as when the control that was pressed has just gone.
export function useFocusWhen(target: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (active && focusIsLost()) target.current?.focus();
  }, [active, target]);
}
