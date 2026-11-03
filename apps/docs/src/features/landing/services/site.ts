// The site's own address, as the structured data names it: origin plus base path.
export function siteAddress(config: { url: string; baseUrl: string }): string {
  return `${config.url}${config.baseUrl}`;
}
