import type { AdminCapability } from '#/shared/service/principal';

export const BRANDING_LEAD =
  'The client’s own pages. A piece set here replaces the tenant’s for sign-ins that start from this client; a piece left unset follows the tenant’s theme, then Instrument’s.';

export const BRANDING_LOADING = 'Loading the client’s branding';

export const BRANDING_FAILED = 'The client’s branding could not be loaded';

export const BRANDING_HELD = 'The client’s branding is read and changed with';

export type BrandingOffer = 'checking' | 'held' | 'open';

// The theme routes need `manage-clients` and apply no service-account ceiling,
// so only a missing capability holds the tab back. Until whoami has answered
// (`caller` undefined) the editor would ask for a theme the caller may not
// read, so it offers neither the editor nor a refusal.
export function brandingOffer(
  caller: readonly AdminCapability[] | undefined,
  needs: readonly AdminCapability[],
): BrandingOffer {
  if (caller === undefined) return 'checking';
  return needs.length > 0 ? 'held' : 'open';
}
