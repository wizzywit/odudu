import { ACCOUNT_PREVIEW_PAGES } from '@odudu/account';
import { AUTHN_PREVIEW_PAGES } from '@odudu/authn-flows';
import { type PageKind, type PreviewRender } from '@odudu/kernel';
import { OIDC_PREVIEW_PAGES } from '@odudu/protocol-oidc';

// Every page kind, rendered by the package that owns it. Typed as a full
// record, so a kind that no package gives a sample fails the build rather
// than the first preview of it.
export const THEME_PREVIEW_PAGES: Readonly<Record<PageKind, PreviewRender>> = {
  ...OIDC_PREVIEW_PAGES,
  ...AUTHN_PREVIEW_PAGES,
  ...ACCOUNT_PREVIEW_PAGES,
};
