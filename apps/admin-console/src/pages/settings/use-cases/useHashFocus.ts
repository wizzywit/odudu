import { useEffect } from 'react';

// A link to a section, opened in another tab or after a reload, lands on it.
export function useHashFocus(
  ready: boolean,
  hash: string,
  focusHeading: (headingId: string) => void,
): void {
  useEffect(() => {
    if (ready) focusHeading(hash);
  }, [ready, hash, focusHeading]);
}
