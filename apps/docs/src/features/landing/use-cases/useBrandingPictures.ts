import { BRANDING } from '@site/src/features/landing/services/brandingClaim';
import { usePageShot } from '@site/src/features/landing/use-cases/usePageShot';

export type Look = 'odudu' | 'other';
export type Scheme = 'light' | 'dark';

export interface BrandingPicture {
  look: Look;
  scheme: Scheme;
  src: string;
  alt: string;
  width: number;
  height: number;
}

// The same sign-in page in each look and each colour scheme, in the order the swap shows them.
export function useBrandingPictures(): BrandingPicture[] {
  const odudu = usePageShot('look-odudu');
  const other = usePageShot('look-other');
  return [
    { look: 'odudu' as const, alt: BRANDING.alt.odudu, shot: odudu },
    { look: 'other' as const, alt: BRANDING.alt.other, shot: other },
  ].flatMap(({ look, alt, shot }) =>
    [
      { scheme: 'light' as const, src: shot.light },
      { scheme: 'dark' as const, src: shot.dark },
    ].map(({ scheme, src }) => ({ look, scheme, src, alt, ...shot.size })),
  );
}
