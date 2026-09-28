import { useLocation, useNavigate } from '@tanstack/react-router';

export interface UrlSearch {
  readonly params: URLSearchParams;
  // Goes to the same page with these parameters, through the router, so the
  // unsaved-changes guard is asked first.
  readonly go: (params: URLSearchParams) => void;
}

export function useUrlSearch(): UrlSearch {
  const { publicHref, searchStr } = useLocation();
  const navigate = useNavigate();
  const pathname = new URL(publicHref, globalThis.location.origin).pathname;
  return {
    params: new URLSearchParams(searchStr),
    go: (params) => {
      const search = params.toString();
      navigate({ href: search === '' ? pathname : `${pathname}?${search}` }).catch(() => undefined);
    },
  };
}
