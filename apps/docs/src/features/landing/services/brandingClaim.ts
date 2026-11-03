export interface BrandingItem {
  id: string;
  title: string;
  claim: string;
  legend: string;
  caption: string;
  alt: { odudu: string; other: string };
  guide: { label: string; path: string };
}

export const BRANDING: BrandingItem = {
  id: 'branding',
  title: 'Branding and theming',
  claim:
    "Every page the server shows can wear a tenant's theme: its colours and font, a logo and a background image, one stylesheet and one page template per page kind. A client can brand its own pages over the tenant's, piece by piece. A draft is previewed on the real page, published as a version and restorable. Colours are checked for contrast before a theme publishes, and a stylesheet may name only the pages' documented classes, so a stylesheet cannot run script or load anything from outside the theme's own images. Mail wears the tenant's logo and colours too, and a client's over them when the sign-in began in that client.",
  legend: 'The same sign-in page in two looks, both drawn by the server',
  caption: 'Same page and same markup. The second look is a tenant theme.',
  alt: {
    odudu:
      "The sign-in page in Odudu's own look: its mark and name above the form, on a plain grid.",
    other:
      "The same sign-in page in a tenant's theme: the tenant's purple colours, a monospaced font, a round logo and a soft purple background behind the form.",
  },
  guide: { label: 'Branding in the console', path: '/admin-console/branding/' },
};
