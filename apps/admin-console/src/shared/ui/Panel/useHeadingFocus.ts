import { useRef } from 'react';

// A removed row took the focus that was on it, so the panel's heading holds
// it: give `heading` to the panel and wrap each removal in `afterRemoval`.
export function useHeadingFocus() {
  const heading = useRef<HTMLHeadingElement>(null);
  const afterRemoval = async (removal: Promise<boolean>): Promise<void> => {
    if (await removal) heading.current?.focus();
  };
  return { heading, afterRemoval };
}
