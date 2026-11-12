import { escapeHtml } from '#/view/document';

// A way on from a page: a path on this server, `text` as escaped markup.
export interface WayOn {
  readonly href: string;
  readonly text: string;
}

// The way back to the application an administrator's link was issued for, or
// nothing when it names none or the client no longer registers the address.
export function applicationWay(href: string | null, text: string): WayOn | null {
  return href === null ? null : { href, text };
}

// The links that close a page, or nothing when there are none.
export function links(ways: readonly (WayOn | null)[]): string {
  const present = ways.filter((way): way is WayOn => way !== null);
  if (present.length === 0) return '';
  const anchors = present.map((way) => `<a href="${escapeHtml(way.href)}">${way.text}</a>`);
  return `\n<p class="links">\n${anchors.join('\n')}\n</p>`;
}
