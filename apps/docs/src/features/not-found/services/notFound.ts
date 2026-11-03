export const NOT_FOUND_TITLE = 'Page not found';
export const NOT_FOUND_MESSAGE =
  'There is nothing at this address. The page may have moved, or the link may be wrong.';

export interface NotFoundRoute {
  id: string;
  label: string;
  // A route of the documentation, as `nav.ts` writes it.
  route: string;
}

export const NOT_FOUND_ROUTES: NotFoundRoute[] = [
  { id: 'home', label: 'Go to the documentation home', route: '/' },
  { id: 'quick-start', label: 'Follow the quick start', route: '/quick-start/' },
];

export const SEARCH_LABEL = 'Search the documentation';

export interface NotFoundContent {
  title: string;
  message: string;
  routes: NotFoundRoute[];
  searchLabel: string;
}

export const NOT_FOUND_CONTENT: NotFoundContent = {
  title: NOT_FOUND_TITLE,
  message: NOT_FOUND_MESSAGE,
  routes: NOT_FOUND_ROUTES,
  searchLabel: SEARCH_LABEL,
};
