import {
  NOT_FOUND_MESSAGE,
  NOT_FOUND_ROUTES,
  NOT_FOUND_TITLE,
  SEARCH_LABEL,
  type NotFoundRoute,
} from '@site/src/features/not-found/services/notFound';

export interface NotFound {
  title: string;
  message: string;
  routes: NotFoundRoute[];
  searchLabel: string;
}

export function useNotFound(): NotFound {
  return {
    title: NOT_FOUND_TITLE,
    message: NOT_FOUND_MESSAGE,
    routes: NOT_FOUND_ROUTES,
    searchLabel: SEARCH_LABEL,
  };
}
