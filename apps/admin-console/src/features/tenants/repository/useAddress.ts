import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

const BASE = '/console';

// Replaces the address, rather than adding one, when the page is at one of
// `among` but its content belongs at `href`: the back button then skips the
// stale one. Any other address is somewhere the person is going.
export function useAddress(href: string, among: readonly string[]): void {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const at = `${BASE}${pathname}`;
  const misplaced = at !== href && among.includes(at);
  useEffect(() => {
    if (misplaced) navigate({ href, replace: true }).catch(() => undefined);
  }, [navigate, misplaced, href]);
}
