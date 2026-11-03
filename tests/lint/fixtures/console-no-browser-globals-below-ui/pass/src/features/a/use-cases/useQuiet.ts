import { pageHref } from '#/shared/lib/platform/location';

export function useQuiet(): string {
  const page = { href: pageHref() };
  return page.href;
}
