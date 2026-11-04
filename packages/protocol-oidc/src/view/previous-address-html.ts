import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { escapeHtml, page } from '#/view/document';
import { t, tHtml } from '#/view/messages';

// What a tenant's previous address answers for the pages it no longer offers:
// the one place to go instead. `canonicalAddress` is the tenant's own issuer
// string, built by the server, so the page reflects nothing the request
// carried and reads no tenant data.
export function renderPreviousAddressPage(
  canonicalAddress: string,
  locale: PageLocale,
): RenderedPage {
  const address = escapeHtml(canonicalAddress);
  return page(
    t(locale, 'movedAddress.title'),
    `<h1>${tHtml(locale, 'movedAddress.title')}</h1>
<p>${tHtml(locale, 'movedAddress.body')}</p>
<p><a href="${address}"><bdi>${address}</bdi></a></p>`,
    null,
    [],
    locale,
  );
}
