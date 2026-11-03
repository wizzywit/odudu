// A route is written relative to the documentation's root, as in `nav.ts`; the
// build decides whether that root is the site root or its `docs/` directory.
export function docsAddress(docsRoute: string, route: string): string {
  return `/${docsRoute}${route.replace(/^\//u, '')}`;
}

export function docsRouteOf(customFields: Record<string, unknown> | undefined): string {
  const route = customFields?.docsRoute;
  if (typeof route !== 'string') throw new Error('the site configuration names no docsRoute');
  return route;
}
