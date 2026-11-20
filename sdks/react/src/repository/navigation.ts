import { navigate } from '#/adapter/location';

// Leaves the page for the issuer or the BFF's login route.
export function navigateTo(url: string): void {
  navigate(url);
}
