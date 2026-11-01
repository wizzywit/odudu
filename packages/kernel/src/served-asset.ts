// The headers on a response whose bytes a tenant uploaded and the server
// serves as itself: an image or a stylesheet that is never a page. The
// policy leaves a browser that opens the URL directly nothing to run, load
// or frame (default-src 'none', sandbox), and `reach` says who may embed
// it. Public brand files are embedded by mail clients and other origins, so
// they send `cross-origin`; the admin's own preview of an image is read
// only by the console, so it sends `same-origin`.
export type AssetReach = 'cross-origin' | 'same-origin';

export function servedAssetHeaders(reach: AssetReach): readonly (readonly [string, string])[] {
  return [
    ['content-security-policy', "default-src 'none'; sandbox"],
    ['cross-origin-resource-policy', reach],
    ['x-content-type-options', 'nosniff'],
  ];
}
