import { currentUrl, navigate } from '#/adapter/location';
import { navigationRefused } from '#/services/errors';
import { safeNavigationTarget } from '#/services/navigation-target';

// The one place the page is left. An address that is not http or https, from
// the BFF or the issuer's metadata, is refused rather than followed.
export function navigateTo(url: string): void {
  const target = safeNavigationTarget(url, currentUrl());
  if (target === undefined) throw navigationRefused();
  navigate(target);
}
