import type { MailBrandingView } from '#/pages/branding/types/mailBranding';
import { previewable } from '#/shared/services/profileUrl';

export const LOGO_TITLE = 'Logo';

export const NO_LOGO = 'None set. The mail shows Odudu’s own mark.';

export const NO_DARK_LOGO = 'None set. The light logo is shown in both schemes.';

export const LOGO_LABEL = 'Logo';

export const DARK_LOGO_LABEL = 'Logo for the dark scheme';

export const LOGO_ELSEWHERE =
  'Not drawn here: this page loads pictures only from its own address. It is shown in the preview above.';

export interface LogoView {
  label: string;
  empty: string;
  src: string | null;
  // The address this page may draw the picture from, when it is its own.
  picture: string | null;
  alt: string | null;
  size: string | null;
}

export function logoViews(branding: MailBrandingView, origin: string): readonly LogoView[] {
  const view = (label: string, empty: string, logo: MailBrandingView['logo']): LogoView => ({
    label,
    empty,
    src: logo?.src ?? null,
    picture: logo !== null && previewable(logo.src, origin) ? logo.src : null,
    alt: logo?.alt ?? null,
    size: logo === null ? null : `${String(logo.width)} by ${String(logo.height)} pixels`,
  });
  return [
    view(LOGO_LABEL, NO_LOGO, branding.logo),
    view(DARK_LOGO_LABEL, NO_DARK_LOGO, branding.dark_logo),
  ];
}
