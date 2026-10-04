import { useLocation, useNavigate } from '@tanstack/react-router';

export interface UrlSearch {
  params: URLSearchParams;
  // Goes to the same page with these parameters, through the router, so the
  // unsaved-changes guard is asked first.
  go: (params: URLSearchParams) => void;
  // Takes one parameter out of the address in place, adding no history entry.
  drop: (name: string) => void;
}

export function useUrlSearch(): UrlSearch {
  const { publicHref, searchStr } = useLocation();
  const navigate = useNavigate();
  const pathname = new URL(publicHref, globalThis.location.origin).pathname;
  const href = (params: URLSearchParams): string => {
    const search = params.toString();
    return search === '' ? pathname : `${pathname}?${search}`;
  };
  return {
    params: new URLSearchParams(searchStr),
    go: (params) => {
      navigate({ href: href(params) }).catch(() => undefined);
    },
    drop: (name) => {
      const params = new URLSearchParams(searchStr);
      if (!params.has(name)) return;
      params.delete(name);
      navigate({ href: href(params), replace: true }).catch(() => undefined);
    },
  };
}
