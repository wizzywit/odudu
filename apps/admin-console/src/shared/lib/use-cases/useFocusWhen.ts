import { useEffect, type RefObject } from 'react';

// Focus the element once `active` turns true, but only when the page has
// lost its focus, as when the control that was pressed has just gone.
export function useFocusWhen(target: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (active && lost) target.current?.focus();
  }, [active, target]);
}
